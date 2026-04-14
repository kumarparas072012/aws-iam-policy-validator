# AWS IAM Policy Validator

Validates AWS IAM policy JSON files instantly — no AWS account or login required. Works like the AWS Access Analyzer playground, right inside VS Code.

## Features

- **Real-time validation** — issues appear in the Problems panel as you type
- **Auto-format on validate** — fixes indentation and arranges keys into canonical IAM order (`Version` → `Statement` → `Sid`, `Effect`, `Action`, `Resource`, `Condition`)
- **Clear fix hints** — every error tells you exactly what is wrong and how to correct it
- **Wildcard support** — `*` is valid for both `Action` and `Resource`
- **Size limit enforcement** — enforces AWS character limits (minified):
  - Managed policy: 6,144 chars
  - Inline policy: 2,048 chars
- **Status bar** — live char count and policy health at a glance
- **Workspace scan** — validate every `.json` file in your workspace at once

## How to use

### 1. Open a policy file

Open any `.json` file that contains an IAM policy. The extension detects it automatically if it has a `Statement` array or a `"Version"` field.

### 2. Validate

Press **`Cmd+Option+P`** (Mac) / **`Ctrl+Alt+P`** (Windows/Linux).

The extension will:
1. Check the JSON is valid and report exactly where it is broken if not
2. Auto-format the document — fixes indentation and reorders keys into canonical IAM order
3. Report every structural issue with a clear message explaining how to fix it
4. Check the policy size against AWS limits (only when the structure is valid)

### 3. Read the results

A popup summarises the outcome:

| Popup | Meaning |
|---|---|
| `AWS IAM Policy is valid.` | No issues found |
| `AWS IAM Policy has 2 error(s), 1 warning(s)...` | Open Problems panel for details |
| `Cannot parse JSON — ...` | File is not valid JSON; reason is shown |

Open the **Problems panel** (`Cmd+Shift+M` / `Ctrl+Shift+M`) to see the full list of issues with fix instructions.

### 4. Fix and re-validate

Fix the issues shown in the Problems panel and press `Cmd+Option+P` again. Repeat until the policy is valid.

## Commands

Open the Command Palette (`Cmd+Shift+P` / `Ctrl+Shift+P`) and search for:

| Command | Description |
|---|---|
| `AWS IAM: Validate Current Policy` | Validate and auto-format the active file |
| `AWS IAM: Validate All Policies in Workspace` | Scan every `.json` file in the workspace |

## Status bar

When an IAM policy file is open, the bottom-right corner shows:

```
✅ IAM: 1,234 / 6,144 chars (20%)
```

| Icon | Meaning |
|---|---|
| `✅` | Policy is valid |
| `⚠️` | Warnings present |
| `❌` | Errors present or invalid JSON |

Click the status bar item to validate and see a summary.

## What gets validated

| Check | Severity | Fix hint shown |
|---|---|---|
| Invalid JSON (bad syntax) | Error | Yes — position and reason |
| Single quotes instead of double quotes | Error | Yes |
| Missing `Statement` field | Error | Yes |
| `Statement` is not an array | Error | Yes |
| Empty `Statement` array | Warning | Yes |
| Missing `Effect` | Error | Yes — add `"Allow"` or `"Deny"` |
| Invalid `Effect` value | Error | Yes — must be exactly `"Allow"` or `"Deny"` |
| Missing `Action` or `NotAction` | Error | Yes — `"*"` is acceptable |
| Both `Action` and `NotAction` present | Error | Yes |
| Malformed action (e.g. `s3-GetObject`) | Warning | Yes — correct format shown |
| Missing `Resource` or `NotResource` | Error | Yes — `"*"` is acceptable |
| Both `Resource` and `NotResource` present | Error | Yes |
| Missing `Version` | Warning | Yes — add `"2012-10-17"` |
| Invalid `Version` value | Error | Yes |
| Approaching managed policy size limit (≥ 90%) | Warning | Yes |
| Exceeding managed policy size limit (6,144 chars) | Error | Yes — split policy |
| Exceeding inline policy size limit (2,048 chars) | Info | Yes |

## Example policy

A valid policy the extension will accept:

```json
{
    "Version": "2012-10-17",
    "Statement": [
        {
            "Sid": "AllowS3Read",
            "Effect": "Allow",
            "Action": [
                "s3:GetObject",
                "s3:ListBucket"
            ],
            "Resource": "arn:aws:s3:::my-bucket/*"
        },
        {
            "Sid": "AllowAllLambda",
            "Effect": "Allow",
            "Action": "lambda:*",
            "Resource": "*"
        }
    ]
}
```

A policy with errors the extension will catch:

```json
{
    "Version": "2012-10-17",
    "Statement": [
        {
            "Sid": "BrokenStatement",
            "Action": ["s3:GetObject"],
            "Resource": "*"
        }
    ]
}
```

Problems panel output:
```
ERROR  Statement "BrokenStatement": missing required "Effect" field.
       Add "Effect": "Allow" or "Effect": "Deny".
```

## Configuration

| Setting | Default | Description |
|---|---|---|
| `awsIamPolicyValidator.managedPolicyLimit` | `6144` | Managed policy character limit |
| `awsIamPolicyValidator.inlinePolicyLimit` | `2048` | Inline policy character limit |
| `awsIamPolicyValidator.warningThresholdPercent` | `90` | % of limit at which a warning appears |

Change these in **Settings** (`Cmd+,`) → search `AWS IAM`.

## Publishing to the VS Code Marketplace

### 1. Bump the version

Update `"version"` in `package.json` (e.g. `0.1.1` → `0.1.2`).

### 2. Build the package

```bash
npm run package
```

This compiles the extension and produces `aws-iam-policy-validator-<version>.vsix` in the project root.

### 3. Upload to the Marketplace

1. Go to [https://marketplace.visualstudio.com/manage](https://marketplace.visualstudio.com/manage)
2. Sign in with your Microsoft account
3. Click publisher **ParasBhangalia**
4. Click **New extension** → **Visual Studio Code**
5. Drag and drop the `.vsix` file onto the upload area and click **Upload**

The extension will be live on the Marketplace within a few minutes.
