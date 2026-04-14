# AWS IAM Policy Validator

Validates AWS IAM policy JSON files instantly — no AWS account, no login, no other extensions required. Works like the AWS Access Analyzer playground, right inside VS Code.

## Requirements

- VS Code 1.74 or higher
- No other extensions needed — works out of the box

## Features

- **Real-time validation** — issues appear in the Problems panel as you type
- **Clear fix hints** — every error tells you exactly what is wrong and how to fix it
- **Wildcard support** — `*` is valid for both `Action` and `Resource`
- **Size limit enforcement** — enforces AWS character limits (minified JSON):
  - Managed policy: 6,144 chars
  - Inline policy: 2,048 chars
- **Status bar** — live char count and policy health at a glance
- **Workspace scan** — validate every `.json` file in your workspace at once

## How to use

### 1. Open a policy file

Open any `.json` file that contains an IAM policy. The extension detects it automatically if it has a `Statement` array or a `"Version"` field and starts validating immediately.

### 2. Validate

Press **`Cmd+Option+P`** (Mac) / **`Ctrl+Alt+P`** (Windows/Linux).

A popup summarises the result:

| Popup | Meaning |
|---|---|
| `AWS IAM Policy is valid.` | No issues found |
| `AWS IAM Policy has 2 error(s), 1 warning(s)...` | Open Problems panel for details |
| `Cannot parse JSON — ...` | File is not valid JSON; reason is shown |

### 3. Read the results

Open the **Problems panel** (`Cmd+Shift+M` / `Ctrl+Shift+M`) to see every issue with a description of how to fix it.

### 4. Fix and re-validate

Fix the issues shown and press `Cmd+Option+P` again. Repeat until the policy is valid.

## Commands

Open the Command Palette (`Cmd+Shift+P` / `Ctrl+Shift+P`) and search for:

| Command | Description |
|---|---|
| `AWS IAM: Validate Current Policy` | Validate the active file |
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

| Check | Severity |
|---|---|
| Invalid JSON (bad syntax) | Error |
| Single quotes instead of double quotes | Error |
| Missing `Statement` field | Error |
| `Statement` is not an array | Error |
| Empty `Statement` array | Warning |
| Missing `Effect` | Error |
| Invalid `Effect` value (not `Allow` or `Deny`) | Error |
| Missing `Action` or `NotAction` | Error |
| Both `Action` and `NotAction` present | Error |
| Malformed action format (e.g. `s3-GetObject`) | Warning |
| Missing `Resource` or `NotResource` | Error |
| Both `Resource` and `NotResource` present | Error |
| Missing `Version` | Warning |
| Invalid `Version` value | Error |
| Approaching managed policy size limit (≥ 90%) | Warning |
| Exceeding managed policy size limit (6,144 chars) | Error |
| Exceeding inline policy size limit (2,048 chars) | Hint |

> `*` is valid for both `Action` and `Resource`.

## Example

Valid policy:

```json
{
    "Version": "2012-10-17",
    "Statement": [
        {
            "Sid": "AllowS3Read",
            "Effect": "Allow",
            "Action": ["s3:GetObject", "s3:ListBucket"],
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

Policy with an error:

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

Update `"version"` in `package.json` (e.g. `0.1.2` → `0.1.3`).

### 2. Build the package

```bash
npm run package
```

This produces `aws-iam-policy-validator-<version>.vsix` in the project root.

### 3. Upload to the Marketplace

1. Go to [https://marketplace.visualstudio.com/manage](https://marketplace.visualstudio.com/manage)
2. Sign in with your Microsoft account
3. Click publisher **ParasBhangalia**
4. Click **New extension** → **Visual Studio Code**
5. Drag and drop the `.vsix` file onto the upload area and click **Upload**

The extension will be live within a few minutes.
