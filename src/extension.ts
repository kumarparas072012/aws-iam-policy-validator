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
  [key: string]: unknown;
}

interface IAMPolicy {
  Version?: string;
  Id?: string;
  Statement?: unknown;
  [key: string]: unknown;
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

  context.subscriptions.push(
    vscode.commands.registerCommand('aws-iam-policy-validator.validate', async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) return;

      const text = editor.document.getText();

      // Parse first — give a clear message if JSON itself is broken
      try {
        JSON.parse(text);
      } catch (err) {
        const hint = /'\s*\w/.test(text.slice(0, 300))
          ? 'File uses single quotes — JSON requires double quotes for all keys and values.'
          : (err as Error).message;
        vscode.window.showErrorMessage(`AWS IAM: Cannot parse JSON — ${hint}`);
        validateDocument(editor.document);
        return;
      }

      validateDocument(editor.document);

      const diags = diagnosticCollection.get(editor.document.uri) ?? [];
      const errors = diags.filter(d => d.severity === vscode.DiagnosticSeverity.Error).length;
      const warnings = diags.filter(d => d.severity === vscode.DiagnosticSeverity.Warning).length;

      if (errors === 0 && warnings === 0) {
        vscode.window.showInformationMessage('$(pass-filled) AWS IAM Policy is valid.');
      } else {
        const parts = [
          errors > 0 ? `${errors} error(s)` : '',
          warnings > 0 ? `${warnings} warning(s)` : '',
        ].filter(Boolean).join(', ');
        vscode.window.showWarningMessage(
          `AWS IAM Policy has ${parts}. Open Problems panel (Cmd+Shift+M) to see what to fix.`
        );
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

  // Auto-validate on open / change / close
  context.subscriptions.push(
    vscode.workspace.onDidOpenTextDocument(validateDocument),
    vscode.workspace.onDidChangeTextDocument(e => validateDocument(e.document)),
    vscode.workspace.onDidCloseTextDocument(doc => diagnosticCollection.delete(doc.uri)),
    vscode.window.onDidChangeActiveTextEditor(editor => {
      if (editor) refreshStatusBar(editor.document);
      else statusBarItem.hide();
    })
  );

  vscode.workspace.textDocuments.forEach(validateDocument);
  if (vscode.window.activeTextEditor) {
    refreshStatusBar(vscode.window.activeTextEditor.document);
  }
}

export function deactivate() {
  diagnosticCollection.dispose();
  statusBarItem.dispose();
}

// ─── Validation pipeline ──────────────────────────────────────────────────────

function validateDocument(document: vscode.TextDocument): boolean {
  if (document.languageId !== 'json' && !document.fileName.endsWith('.json')) {
    return false;
  }

  const text = document.getText();
  const diagnostics: vscode.Diagnostic[] = [];

  // 1. Parse JSON
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (err) {
    const hasSingleQuotes = /'\s*\w/.test(text.slice(0, 300));
    const msg = hasSingleQuotes
      ? 'Invalid JSON: file uses single quotes (\') instead of double quotes ("). JSON requires double quotes for all keys and values.'
      : `Invalid JSON: ${(err as Error).message}`;
    diagnostics.push(makeDiag(jsonErrorRange(document, err as SyntaxError), msg, vscode.DiagnosticSeverity.Error));
    diagnosticCollection.set(document.uri, diagnostics);
    refreshStatusBar(document, diagnostics, -1);
    return true;
  }

  // 2. Detect IAM policy
  if (!isIAMPolicy(parsed)) {
    diagnosticCollection.set(document.uri, []);
    if (vscode.window.activeTextEditor?.document.uri.toString() === document.uri.toString()) {
      statusBarItem.hide();
    }
    return false;
  }

  // 3. Structural validation
  diagnostics.push(...validateStructure(document, parsed as IAMPolicy));

  // 4. Size check (only when structurally valid)
  const hasErrors = diagnostics.some(d => d.severity === vscode.DiagnosticSeverity.Error);
  const minifiedLen = JSON.stringify(parsed).length;
  if (!hasErrors) {
    diagnostics.push(...checkLimits(document, minifiedLen));
  }

  diagnosticCollection.set(document.uri, diagnostics);
  refreshStatusBar(document, diagnostics, minifiedLen);
  return true;
}

// ─── Structural validation ────────────────────────────────────────────────────

function validateStructure(doc: vscode.TextDocument, policy: IAMPolicy): vscode.Diagnostic[] {
  const diags: vscode.Diagnostic[] = [];

  // Version
  if (policy.Version === undefined) {
    diags.push(makeDiag(
      new vscode.Range(0, 0, 0, 1),
      'Missing "Version" field. Add "Version": "2012-10-17" as the first field in your policy.',
      vscode.DiagnosticSeverity.Warning
    ));
  } else if (!VALID_VERSIONS.includes(policy.Version)) {
    diags.push(makeDiag(
      findKeyRange(doc, 'Version'),
      `Invalid version "${policy.Version}". Use "2012-10-17" (recommended) or "2008-10-17".`,
      vscode.DiagnosticSeverity.Error
    ));
  }

  // Statement
  if (policy.Statement === undefined) {
    diags.push(makeDiag(
      new vscode.Range(0, 0, 0, 1),
      'Missing required "Statement" field. Add a "Statement" array containing at least one statement object.',
      vscode.DiagnosticSeverity.Error
    ));
    return diags;
  }

  if (!Array.isArray(policy.Statement)) {
    diags.push(makeDiag(
      findKeyRange(doc, 'Statement'),
      '"Statement" must be an array ([ ]). Wrap your statement object in square brackets.',
      vscode.DiagnosticSeverity.Error
    ));
    return diags;
  }

  if (policy.Statement.length === 0) {
    diags.push(makeDiag(
      findKeyRange(doc, 'Statement'),
      '"Statement" array is empty. Add at least one statement with Effect, Action, and Resource.',
      vscode.DiagnosticSeverity.Warning
    ));
    return diags;
  }

  (policy.Statement as IAMStatement[]).forEach((stmt, idx) => {
    diags.push(...validateStatement(doc, stmt, idx));
  });

  return diags;
}

function validateStatement(doc: vscode.TextDocument, stmt: IAMStatement, idx: number): vscode.Diagnostic[] {
  const diags: vscode.Diagnostic[] = [];
  const label = stmt.Sid ? `Statement "${stmt.Sid}"` : `Statement[${idx + 1}]`;
  const range = stmt.Sid ? findKeyRange(doc, stmt.Sid) : new vscode.Range(0, 0, 0, 1);

  if (typeof stmt !== 'object' || stmt === null) {
    diags.push(makeDiag(range, `${label}: each statement must be a JSON object { }.`, vscode.DiagnosticSeverity.Error));
    return diags;
  }

  // Effect
  if (!stmt.Effect) {
    diags.push(makeDiag(
      range,
      `${label}: missing required "Effect" field. Add "Effect": "Allow" or "Effect": "Deny".`,
      vscode.DiagnosticSeverity.Error
    ));
  } else if (!['Allow', 'Deny'].includes(stmt.Effect)) {
    diags.push(makeDiag(
      findKeyRange(doc, stmt.Effect),
      `${label}: "Effect" is "${stmt.Effect}" but must be exactly "Allow" or "Deny" (case-sensitive).`,
      vscode.DiagnosticSeverity.Error
    ));
  }

  // Action / NotAction
  const hasAction = stmt.Action !== undefined;
  const hasNotAction = stmt.NotAction !== undefined;

  if (!hasAction && !hasNotAction) {
    diags.push(makeDiag(
      range,
      `${label}: missing required "Action" field. Add "Action": "*" to allow all actions, or specify actions like "Action": ["s3:GetObject", "s3:PutObject"].`,
      vscode.DiagnosticSeverity.Error
    ));
  } else if (hasAction && hasNotAction) {
    diags.push(makeDiag(
      range,
      `${label}: cannot have both "Action" and "NotAction" in the same statement. Remove one of them.`,
      vscode.DiagnosticSeverity.Error
    ));
  } else if (hasAction) {
    const actions = ([] as unknown[]).concat(stmt.Action);
    actions.forEach(a => {
      if (typeof a !== 'string') {
        diags.push(makeDiag(range, `${label}: each action must be a string (e.g. "s3:GetObject" or "*").`, vscode.DiagnosticSeverity.Error));
      } else if (a !== '*' && !/^[\w-]+:[\w*]+$/.test(a)) {
        diags.push(makeDiag(
          range,
          `${label}: action "${a}" is malformed. Use the format "service:Action" (e.g. "s3:GetObject", "lambda:Invoke*") or "*" for all actions.`,
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
      range,
      `${label}: missing required "Resource" field. Add "Resource": "*" for all resources, or specify an ARN like "Resource": "arn:aws:s3:::my-bucket/*".`,
      vscode.DiagnosticSeverity.Error
    ));
  } else if (hasResource && hasNotResource) {
    diags.push(makeDiag(
      range,
      `${label}: cannot have both "Resource" and "NotResource" in the same statement. Remove one of them.`,
      vscode.DiagnosticSeverity.Error
    ));
  }

  return diags;
}

// ─── Size check ───────────────────────────────────────────────────────────────

function checkLimits(doc: vscode.TextDocument, charCount: number): vscode.Diagnostic[] {
  const diags: vscode.Diagnostic[] = [];
  const { managedLimit, inlineLimit, warnPercent } = getConfig();
  const fullRange = new vscode.Range(0, 0, doc.lineCount - 1, 0);

  if (charCount > managedLimit) {
    diags.push(makeDiag(
      fullRange,
      `Policy exceeds the AWS managed policy size limit: ${fmt(charCount)} / ${fmt(managedLimit)} characters (minified). ` +
      `${fmt(charCount - managedLimit)} characters over limit — split into multiple policies to fix.`,
      vscode.DiagnosticSeverity.Error
    ));
  } else if (charCount > managedLimit * warnPercent) {
    diags.push(makeDiag(
      fullRange,
      `Policy is approaching the AWS managed policy size limit: ${fmt(charCount)} / ${fmt(managedLimit)} characters (${pct(charCount, managedLimit)}% used). ` +
      `Only ${fmt(managedLimit - charCount)} characters remaining.`,
      vscode.DiagnosticSeverity.Warning
    ));
  }

  if (charCount > inlineLimit && charCount <= managedLimit) {
    diags.push(makeDiag(
      fullRange,
      `Policy exceeds the inline policy size limit (${fmt(charCount)} / ${fmt(inlineLimit)} characters). ` +
      `This policy must be used as a managed policy — it is too large to attach inline.`,
      vscode.DiagnosticSeverity.Hint
    ));
  }

  return diags;
}

// ─── Arrange (canonical key order) ───────────────────────────────────────────


// ─── IAM detection ────────────────────────────────────────────────────────────

function isIAMPolicy(obj: unknown): boolean {
  if (typeof obj !== 'object' || obj === null || Array.isArray(obj)) return false;
  const o = obj as Record<string, unknown>;
  return (
    o.Statement !== undefined ||
    (typeof o.Version === 'string' && VALID_VERSIONS.includes(o.Version))
  );
}

// ─── Status bar ───────────────────────────────────────────────────────────────

function refreshStatusBar(doc: vscode.TextDocument, diagnostics?: readonly vscode.Diagnostic[], charCount?: number) {
  if (vscode.window.activeTextEditor?.document.uri.toString() !== doc.uri.toString()) return;

  const diags = diagnostics ?? diagnosticCollection.get(doc.uri) ?? [];
  const chars = charCount ?? -2;

  if (chars === -2) { statusBarItem.hide(); return; }

  const { managedLimit } = getConfig();
  const errors = diags.filter(d => d.severity === vscode.DiagnosticSeverity.Error).length;
  const warnings = diags.filter(d => d.severity === vscode.DiagnosticSeverity.Warning).length;

  let icon: string;
  let bg: vscode.ThemeColor | undefined;

  if (chars === -1) {
    statusBarItem.text = '$(error) IAM: Invalid JSON';
    statusBarItem.tooltip = 'AWS IAM Policy: File contains invalid JSON. Click to validate.';
    statusBarItem.backgroundColor = new vscode.ThemeColor('statusBarItem.errorBackground');
    statusBarItem.show();
    return;
  }

  if (errors > 0) {
    icon = '$(error)'; bg = new vscode.ThemeColor('statusBarItem.errorBackground');
  } else if (warnings > 0) {
    icon = '$(warning)'; bg = new vscode.ThemeColor('statusBarItem.warningBackground');
  } else {
    icon = '$(pass-filled)'; bg = undefined;
  }

  const percent = pct(chars, managedLimit);
  statusBarItem.text = `${icon} IAM: ${fmt(chars)} / ${fmt(managedLimit)} chars (${percent}%)`;
  statusBarItem.backgroundColor = bg;
  statusBarItem.tooltip = [
    'AWS IAM Policy Validator',
    '─────────────────────────',
    `Size          : ${fmt(chars)} / ${fmt(managedLimit)} chars (${percent}%)`,
    `Inline limit  : ${fmt(getConfig().inlineLimit)} chars`,
    `Errors        : ${errors}`,
    `Warnings      : ${warnings}`,
    '',
    'Click to validate',
  ].join('\n');
  statusBarItem.show();
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeDiag(range: vscode.Range, message: string, severity: vscode.DiagnosticSeverity): vscode.Diagnostic {
  const d = new vscode.Diagnostic(range, message, severity);
  d.source = SOURCE;
  return d;
}

function findKeyRange(doc: vscode.TextDocument, key: string, startOffset = 0): vscode.Range {
  const text = doc.getText();
  const needle = `"${key}"`;
  const idx = text.indexOf(needle, startOffset);
  if (idx === -1) return new vscode.Range(0, 0, 0, 1);
  return new vscode.Range(doc.positionAt(idx), doc.positionAt(idx + needle.length));
}

function jsonErrorRange(doc: vscode.TextDocument, err: SyntaxError): vscode.Range {
  const match = err.message.match(/position (\d+)/);
  if (match) {
    const pos = doc.positionAt(parseInt(match[1], 10));
    return new vscode.Range(pos, new vscode.Position(pos.line, pos.character + 1));
  }
  return new vscode.Range(0, 0, 0, 1);
}

function fmt(n: number): string { return n.toLocaleString(); }
function pct(value: number, max: number): number { return Math.round((value / max) * 100); }
