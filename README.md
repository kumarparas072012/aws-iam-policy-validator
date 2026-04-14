# AWS IAM Policy Validator

A VS Code extension that validates AWS IAM policy JSON files as you type — catching malformed JSON, structural issues, and AWS size limits before you deploy.

## Features

- **Real-time validation** — errors appear in the Problems panel as you edit
- **Structural checks** — validates `Version`, `Effect`, `Action`, `Resource`, and more
- **Size limit enforcement** — warns when approaching or exceeding AWS character limits:
  - Managed policy: 6,144 chars (minified)
  - Inline policy: 2,048 chars (minified)
- **Status bar** — shows live char count and policy health for any open IAM policy file
- **Workspace scan** — validate all `.json` files in your workspace at once

## Usage

The extension activates automatically on any `.json` file. If the file looks like an IAM policy (has a `Statement` array or a known `Version`), it is validated immediately.

### Commands

Open the Command Palette (`Cmd+Shift+P` / `Ctrl+Shift+P`) and search for:

| Command | Description |
|---|---|
| `AWS IAM: Validate Current Policy` | Validate the file in the active editor |
| `AWS IAM: Validate All Policies in Workspace` | Scan every `.json` file in the workspace |

### Keyboard shortcut

`Cmd+Alt+P` (Mac) / `Ctrl+Alt+P` (Windows/Linux) — validates the current file instantly.

### Status bar

When an IAM policy is open, the bottom-right status bar shows:

```
✅ IAM: 1,234 / 6,144 chars (20%)
```

Click it to validate and see a summary message. The icon changes to `⚠️` or `❌` when warnings or errors are present.

## What gets validated

| Check | Severity |
|---|---|
| Invalid JSON | Error |
| Missing `Statement` field | Error |
| `Statement` is not an array | Error |
| Missing or invalid `Effect` (`Allow`/`Deny`) | Error |
| Missing `Action` or `NotAction` | Error |
| Both `Action` and `NotAction` present | Error |
| Missing `Resource` or `NotResource` | Error |
| Both `Resource` and `NotResource` present | Error |
| Malformed action string (e.g. `s3-GetObject`) | Warning |
| Missing `Version` field | Warning |
| Empty `Statement` array | Warning |
| Approaching managed policy size limit (≥ 90%) | Warning |
| Exceeding managed policy size limit | Error |
| Exceeding inline policy size limit | Info |

## Configuration

| Setting | Default | Description |
|---|---|---|
| `awsIamPolicyValidator.managedPolicyLimit` | `6144` | Managed policy character limit |
| `awsIamPolicyValidator.inlinePolicyLimit` | `2048` | Inline policy character limit |
| `awsIamPolicyValidator.warningThresholdPercent` | `90` | % of limit at which a warning appears |

Change these in **Settings** (`Cmd+,`) → search `AWS IAM`.

## Example policy

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "AllowS3Read",
      "Effect": "Allow",
      "Action": ["s3:GetObject", "s3:ListBucket"],
      "Resource": "arn:aws:s3:::my-bucket/*"
    }
  ]
}
```

## Publishing to the VS Code Marketplace

### 1. Bump the version

Update `"version"` in `package.json` (e.g. `0.1.0` → `0.1.1`).

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
