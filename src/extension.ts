import * as vscode from 'vscode';

// ─── Types ────────────────────────────────────────────────────────────────────

interface IAMStatement {
  Sid?: string;
  Effect?: string;
  Action?: string | string[];
  NotAction?: string | string[];
  Resource?: string | string[];
  NotResource?: string | string[];
  Principal?: unknown;
  NotPrincipal?: unknown;
  Condition?: unknown;
}

interface IAMPolicy {
  Version?: string;
  Id?: string;
  Statement?: IAMStatement[];
}

// ─── Constants ────────────────────────────────────────────────────────────────

const SOURCE = 'AWS IAM Policy Validator';
const VALID_VERSIONS = ['2012-10-17', '2008-10-17'];

function getConfig() {
  const cfg = vscode.workspace.getConfiguration('awsIamPolicyValidator');
  return {
    managedLimit: cfg.get<number>('managedPolicyLimit', 6144),
    inlineLimit: cfg.get<number>('inlinePolicyLimit', 2048),
    warnPercent: cfg.get<number>('warningThresholdPercent', 90) / 100,
  };
}

// ─── Activation ───────────────────────────────────────────────────────────────

let diagnosticCollection: vscode.DiagnosticCollection;
let statusBarItem: vscode.StatusBarItem;

export function activate(context: vscode.ExtensionContext) {
  diagnosticCollection = vscode.languages.createDiagnosticCollection('aws-iam-policy');
  context.subscriptions.push(diagnosticCollection);

  statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  statusBarItem.command = 'aws-iam-policy-validator.validate';
  context.subscriptions.push(statusBarItem);

  // Commands
  context.subscriptions.push(
    vscode.commands.registerCommand('aws-iam-policy-validator.validate', () => {
      const editor = vscode.window.activeTextEditor;
      if (editor) {
        validateDocument(editor.document);
        const diags = diagnosticCollection.get(editor.document.uri) ?? [];
        const errors = diags.filter(d => d.severity === vscode.DiagnosticSeverity.Error).length;
        const warnings = diags.filter(d => d.severity === vscode.DiagnosticSeverity.Warning).length;
        if (errors === 0 && warnings === 0) {
          vscode.window.showInformationMessage('AWS IAM Policy: No issues found.');
        } else {
          vscode.window.showWarningMessage(
            `AWS IAM Policy: ${errors} error(s), ${warnings} warning(s). See Problems panel.`
          );
        }
      }
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('aws-iam-policy-validator.validateAll', async () => {
      const files = await vscode.workspace.findFiles('**/*.json', '**/node_modules/**');
      let count = 0;
      for (const file of files) {
        const doc = await vscode.workspace.openTextDocument(file);
        const isPolicy = validateDocument(doc);
        if (isPolicy) count++;
      }
      vscode.window.showInformationMessage(
        `AWS IAM: Validated ${count} policy file(s). See Problems panel for issues.`
      );
    })
  );

  // Event listeners
  context.subscriptions.push(
    vscode.workspace.onDidOpenTextDocument(validateDocument),
    vscode.workspace.onDidChangeTextDocument(e => validateDocument(e.document)),
    vscode.workspace.onDidCloseTextDocument(doc => {
      diagnosticCollection.delete(doc.uri);
    }),
    vscode.window.onDidChangeActiveTextEditor(editor => {
      if (editor) {
        refreshStatusBar(editor.document);
      } else {
        statusBarItem.hide();
      }
    })
  );

  // Validate already-open documents
  vscode.workspace.textDocuments.forEach(validateDocument);
  if (vscode.window.activeTextEditor) {
    refreshStatusBar(vscode.window.activeTextEditor.document);
  }
}

export function deactivate() {
  diagnosticCollection.dispose();
  statusBarItem.dispose();
}

// ─── Main validator ───────────────────────────────────────────────────────────

/**
 * Validates a document. Returns true if it was recognised as an IAM policy.
 */
function validateDocument(document: vscode.TextDocument): boolean {
  if (document.languageId !== 'json' && !document.fileName.endsWith('.json')) {
    return false;
  }

  const text = document.getText();
  const diagnostics: vscode.Diagnostic[] = [];

  // ── 1. JSON parse ──────────────────────────────────────────────────────────
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (err) {
    const range = jsonErrorRange(document, err as SyntaxError);
    diagnostics.push(makeDiag(range, `Invalid JSON: ${(err as Error).message}`, vscode.DiagnosticSeverity.Error));
    diagnosticCollection.set(document.uri, diagnostics);
    refreshStatusBar(document, diagnostics, -1);
    return true; // treat any JSON file with a parse error as worth reporting
  }

  // ── 2. IAM policy detection ────────────────────────────────────────────────
  if (!isIAMPolicy(parsed)) {
    diagnosticCollection.set(document.uri, []);
    if (vscode.window.activeTextEditor?.document.uri.toString() === document.uri.toString()) {
      statusBarItem.hide();
    }
    return false;
  }

  const policy = parsed as IAMPolicy;

  // ── 3. Structure validation ────────────────────────────────────────────────
  diagnostics.push(...validateStructure(document, policy));

  // ── 4. Character limit check ───────────────────────────────────────────────
  const minifiedLen = JSON.stringify(parsed).length;
  diagnostics.push(...checkLimits(document, minifiedLen));

  diagnosticCollection.set(document.uri, diagnostics);
  refreshStatusBar(document, diagnostics, minifiedLen);
  return true;
}

// ─── IAM detection ────────────────────────────────────────────────────────────

function isIAMPolicy(obj: unknown): boolean {
  if (typeof obj !== 'object' || obj === null || Array.isArray(obj)) return false;
  const o = obj as Record<string, unknown>;
  // Must look like an IAM policy: has Statement (array or any) or a known Version
  return (
    o.Statement !== undefined ||
    (typeof o.Version === 'string' && VALID_VERSIONS.includes(o.Version))
  );
}

// ─── Structure validation ─────────────────────────────────────────────────────

function validateStructure(doc: vscode.TextDocument, policy: IAMPolicy): vscode.Diagnostic[] {
  const diags: vscode.Diagnostic[] = [];

  // Version
  if (policy.Version === undefined) {
    diags.push(makeDiag(
      new vscode.Range(0, 0, 0, 1),
      'Missing recommended "Version" field. AWS recommends "2012-10-17".',
      vscode.DiagnosticSeverity.Warning
    ));
  } else if (!VALID_VERSIONS.includes(policy.Version)) {
    diags.push(makeDiag(
      findKeyRange(doc, 'Version'),
      `Unknown policy version "${policy.Version}". Valid values: ${VALID_VERSIONS.map(v => `"${v}"`).join(', ')}.`,
      vscode.DiagnosticSeverity.Error
    ));
  }

  // Statement presence
  if (policy.Statement === undefined) {
    diags.push(makeDiag(
      new vscode.Range(0, 0, 0, 1),
      'Missing required "Statement" field.',
      vscode.DiagnosticSeverity.Error
    ));
    return diags;
  }

  if (!Array.isArray(policy.Statement)) {
    diags.push(makeDiag(
      findKeyRange(doc, 'Statement'),
      '"Statement" must be an array.',
      vscode.DiagnosticSeverity.Error
    ));
    return diags;
  }

  if (policy.Statement.length === 0) {
    diags.push(makeDiag(
      findKeyRange(doc, 'Statement'),
      '"Statement" array is empty — no permissions are granted or denied.',
      vscode.DiagnosticSeverity.Warning
    ));
    return diags;
  }

  // Individual statements
  policy.Statement.forEach((stmt, idx) => {
    diags.push(...validateStatement(doc, stmt, idx));
  });

  return diags;
}

function validateStatement(doc: vscode.TextDocument, stmt: IAMStatement, idx: number): vscode.Diagnostic[] {
  const diags: vscode.Diagnostic[] = [];
  const label = stmt.Sid ? `Statement "${stmt.Sid}"` : `Statement[${idx}]`;
  // Best-effort: try to locate the Sid or fall back to line 0
  const stmtRange = stmt.Sid ? findKeyRange(doc, stmt.Sid) : new vscode.Range(0, 0, 0, 1);

  if (typeof stmt !== 'object' || stmt === null) {
    diags.push(makeDiag(stmtRange, `${label}: must be an object.`, vscode.DiagnosticSeverity.Error));
    return diags;
  }

  // Effect
  if (!stmt.Effect) {
    diags.push(makeDiag(stmtRange, `${label}: missing required "Effect" field.`, vscode.DiagnosticSeverity.Error));
  } else if (!['Allow', 'Deny'].includes(stmt.Effect)) {
    diags.push(makeDiag(
      stmtRange,
      `${label}: "Effect" must be "Allow" or "Deny", got "${stmt.Effect}".`,
      vscode.DiagnosticSeverity.Error
    ));
  }

  // Action / NotAction
  const hasAction = stmt.Action !== undefined;
  const hasNotAction = stmt.NotAction !== undefined;
  if (!hasAction && !hasNotAction) {
    diags.push(makeDiag(stmtRange, `${label}: missing required "Action" or "NotAction".`, vscode.DiagnosticSeverity.Error));
  } else if (hasAction && hasNotAction) {
    diags.push(makeDiag(stmtRange, `${label}: cannot have both "Action" and "NotAction".`, vscode.DiagnosticSeverity.Error));
  } else if (hasAction) {
    const actions = ([] as string[]).concat(stmt.Action as string | string[]);
    actions.forEach(a => {
      if (typeof a !== 'string') {
        diags.push(makeDiag(stmtRange, `${label}: Action values must be strings.`, vscode.DiagnosticSeverity.Error));
      } else if (a !== '*' && !/^[\w*]+:[\w*]+$/.test(a)) {
        diags.push(makeDiag(
          stmtRange,
          `${label}: Action "${a}" looks malformed — expected format "service:Action" or "*".`,
          vscode.DiagnosticSeverity.Warning
        ));
      }
    });
  }

  // Resource / NotResource
  const hasResource = stmt.Resource !== undefined;
  const hasNotResource = stmt.NotResource !== undefined;
  const hasPrincipal = stmt.Principal !== undefined || stmt.NotPrincipal !== undefined;

  if (!hasResource && !hasNotResource && !hasPrincipal) {
    diags.push(makeDiag(
      stmtRange,
      `${label}: missing "Resource" or "NotResource" field.`,
      vscode.DiagnosticSeverity.Error
    ));
  } else if (hasResource && hasNotResource) {
    diags.push(makeDiag(stmtRange, `${label}: cannot have both "Resource" and "NotResource".`, vscode.DiagnosticSeverity.Error));
  }

  return diags;
}

// ─── Character limit check ────────────────────────────────────────────────────

function checkLimits(doc: vscode.TextDocument, charCount: number): vscode.Diagnostic[] {
  const diags: vscode.Diagnostic[] = [];
  const { managedLimit, inlineLimit, warnPercent } = getConfig();
  const fullRange = new vscode.Range(0, 0, doc.lineCount - 1, 0);

  // Managed policy limit
  if (charCount > managedLimit) {
    diags.push(makeDiag(
      fullRange,
      `Exceeds AWS managed policy size limit: ${fmt(charCount)} / ${fmt(managedLimit)} chars (minified). ` +
      `${fmt(charCount - managedLimit)} chars over — consider splitting into multiple policies.`,
      vscode.DiagnosticSeverity.Error
    ));
  } else if (charCount > managedLimit * warnPercent) {
    const remaining = managedLimit - charCount;
    diags.push(makeDiag(
      fullRange,
      `Approaching AWS managed policy limit: ${fmt(charCount)} / ${fmt(managedLimit)} chars (${pct(charCount, managedLimit)}%). ` +
      `Only ${fmt(remaining)} chars remaining.`,
      vscode.DiagnosticSeverity.Warning
    ));
  }

  // Inline policy limit (informational when over, unless already an error)
  if (charCount > inlineLimit && charCount <= managedLimit) {
    diags.push(makeDiag(
      fullRange,
      `Policy exceeds inline policy size limit (${fmt(charCount)} / ${fmt(inlineLimit)} chars minified). ` +
      `This policy can only be used as a managed policy, not an inline policy.`,
      vscode.DiagnosticSeverity.Information
    ));
  }

  return diags;
}

// ─── Status bar ───────────────────────────────────────────────────────────────

function refreshStatusBar(
  doc: vscode.TextDocument,
  diagnostics?: readonly vscode.Diagnostic[],
  charCount?: number
) {
  // Only show for the active editor
  if (vscode.window.activeTextEditor?.document.uri.toString() !== doc.uri.toString()) return;

  const diags = diagnostics ?? diagnosticCollection.get(doc.uri) ?? [];
  const chars = charCount ?? -2; // -2 = not an IAM policy

  if (chars === -2) {
    statusBarItem.hide();
    return;
  }

  const { managedLimit } = getConfig();
  const errors = diags.filter(d => d.severity === vscode.DiagnosticSeverity.Error).length;
  const warnings = diags.filter(d => d.severity === vscode.DiagnosticSeverity.Warning).length;

  let icon: string;
  let bg: vscode.ThemeColor | undefined;

  if (chars === -1) {
    icon = '$(error)';
    bg = new vscode.ThemeColor('statusBarItem.errorBackground');
    statusBarItem.text = `${icon} IAM: Invalid JSON`;
    statusBarItem.tooltip = 'AWS IAM Policy: File contains invalid JSON. Click to re-validate.';
    statusBarItem.backgroundColor = bg;
    statusBarItem.show();
    return;
  }

  if (errors > 0) {
    icon = '$(error)';
    bg = new vscode.ThemeColor('statusBarItem.errorBackground');
  } else if (warnings > 0) {
    icon = '$(warning)';
    bg = new vscode.ThemeColor('statusBarItem.warningBackground');
  } else {
    icon = '$(pass-filled)';
    bg = undefined;
  }

  const percent = pct(chars, managedLimit);
  statusBarItem.text = `${icon} IAM: ${fmt(chars)} / ${fmt(managedLimit)} chars (${percent}%)`;
  statusBarItem.backgroundColor = bg;
  statusBarItem.tooltip = [
    'AWS IAM Policy Validator',
    `─────────────────────────`,
    `Minified size : ${fmt(chars)} chars`,
    `Managed limit : ${fmt(managedLimit)} chars  (${percent}% used)`,
    `Inline limit  : ${fmt(getConfig().inlineLimit)} chars`,
    ``,
    `Errors   : ${errors}`,
    `Warnings : ${warnings}`,
    ``,
    `Click to validate & see summary`,
  ].join('\n');
  statusBarItem.show();
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeDiag(range: vscode.Range, message: string, severity: vscode.DiagnosticSeverity): vscode.Diagnostic {
  const d = new vscode.Diagnostic(range, message, severity);
  d.source = SOURCE;
  return d;
}

/** Find the range covering the JSON key string (e.g. "Version") in the document. */
function findKeyRange(doc: vscode.TextDocument, key: string, startOffset = 0): vscode.Range {
  const text = doc.getText();
  const needle = `"${key}"`;
  const idx = text.indexOf(needle, startOffset);
  if (idx === -1) return new vscode.Range(0, 0, 0, 1);
  return new vscode.Range(doc.positionAt(idx), doc.positionAt(idx + needle.length));
}

/** Convert a JSON SyntaxError to a document range. */
function jsonErrorRange(doc: vscode.TextDocument, err: SyntaxError): vscode.Range {
  const match = err.message.match(/position (\d+)/);
  if (match) {
    const pos = doc.positionAt(parseInt(match[1], 10));
    return new vscode.Range(pos, new vscode.Position(pos.line, pos.character + 1));
  }
  return new vscode.Range(0, 0, 0, 1);
}

function fmt(n: number): string {
  return n.toLocaleString();
}

function pct(value: number, max: number): number {
  return Math.round((value / max) * 100);
}
