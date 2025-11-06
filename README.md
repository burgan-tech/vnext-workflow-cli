# 🚀 vNext Workflow CLI

Cross-platform modern workflow management tool.

[![npm version](https://img.shields.io/npm/v/@burgan-tech/vnext-workflow-cli.svg)](https://www.npmjs.com/package/@burgan-tech/vnext-workflow-cli)
[![npm downloads](https://img.shields.io/npm/dm/@burgan-tech/vnext-workflow-cli.svg)](https://www.npmjs.com/package/@burgan-tech/vnext-workflow-cli)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

A command-line interface (CLI) tool for managing vNext workflows, tasks, schemas, views, functions, and extensions. This tool helps you synchronize your local workflow definitions with the vNext API and database.

**Package**: `@burgan-tech/vnext-workflow-cli`  
**NPM**: https://www.npmjs.com/package/@burgan-tech/vnext-workflow-cli  
**GitHub**: https://github.com/burgan-tech/vnext-workflow-cli

## 📦 Installation

### Install from NPM (Recommended)

```bash
# Install globally
npm install -g @burgan-tech/vnext-workflow-cli

# Or install as a project dependency
npm install @burgan-tech/vnext-workflow-cli
```

After installation, you can use the CLI with:
```bash
wf --version
wf check
```

### Install from Source

```bash
# Clone the repository
git clone https://github.com/burgan-tech/vnext-workflow-cli.git
cd vnext-workflow-cli

# Install dependencies
npm install

# Link globally (for development)
npm link
```

### Requirements

- Node.js >= 14.0.0
- npm or yarn
- PostgreSQL (for database operations)
- Docker (optional, for PostgreSQL container)

---

## ⚡ Quick Start

### Initial Configuration

After installation, configure the CLI:

```bash
# Set project root path (REQUIRED)
wf config set PROJECT_ROOT /path/to/your/vnext-project

# Database settings
wf config set DB_PASSWORD postgres
wf config set USE_DOCKER true
wf config set DOCKER_POSTGRES_CONTAINER vnext-postgres

# Verify configuration
wf check
```

### Basic Usage

```bash
# System status check
wf check

# Update CSX + JSON files (automatically finds changed files)
wf update

# Add missing workflows to database
wf sync

# Reset workflows (delete from DB and re-add)
wf reset
```

---

## 📖 Commands

### `wf check`
Checks system status (API, DB, folders).

### `wf config <action> [key] [value]`
Configuration management:
```bash
wf config get              # Show all settings
wf config get PROJECT_ROOT # Show a specific setting
wf config set DB_PASSWORD pass # Change a setting
```

### `wf csx [options]`
Converts CSX files to Base64 and embeds them in JSON files.
```bash
wf csx              # Process changed files in Git
wf csx --all        # Process all CSX files
wf csx --file x.csx # Process a single file
```

### `wf update [options]`
Updates workflows (CSX is automatically updated!).
```bash
wf update                # Process changed files in Git (CSX + JSON)
wf update --all          # Update all (asks for confirmation)
wf update --file x.json  # Process a single file
```

**Process steps:**
1. 📝 Converts changed CSX files to base64 and writes to JSON files
2. 🗑️ Deletes existing record from DB
3. 📤 POSTs to API
4. ✅ Activates the workflow
5. 🔄 Restarts the system

### `wf sync`
Updates all CSX files and adds missing ones to the database.
```bash
wf sync  # Update all CSX files + add missing ones
```

### `wf reset`
Resets workflows with an interactive menu (even if there are no changes).
```bash
wf reset  # Select folder from menu
```

**Menu:**
```
? Which folder should be reset?
❯ 🔵 Workflows (sys-flows)
  📋 Tasks (sys-tasks)
  📊 Schemas (sys-schemas)
  👁️  Views (sys-views)
  ⚙️  Functions (sys-functions)
  🔌 Extensions (sys-extensions)
  ──────────────
  🔴 ALL (All folders)
```

---

## 💡 Usage Scenarios

### 1. Changing and Updating CSX File
```bash
# Edit CSX file
vim AddToCartMapping.csx

# Update in one command (CSX + JSON automatic)
wf update
```

### 2. Updating Only CSX (Without Writing to DB)
```bash
# Convert CSX files to base64 and write to JSON files
wf csx
```

### 3. Initial Setup / Full Sync
```bash
# Update all CSX files + add missing ones
wf sync
```

### 4. Resetting Workflows (Delete from DB and Re-add)
```bash
# With interactive menu (RECOMMENDED)
wf reset

# Reset all
wf update --all

# Single file
wf update --file /path/to/file.json
```

---

## ⚙️ Configuration

Config file location: `~/.config/vnext-workflow-cli/config.json`

### Important Settings
```bash
# Project root path (REQUIRED)
wf config set PROJECT_ROOT /path/to/project

# API settings
wf config set API_BASE_URL http://localhost:4201
wf config set API_VERSION v1

# Database settings
wf config set DB_HOST localhost
wf config set DB_PORT 5432
wf config set DB_NAME vNext_WorkflowDb
wf config set DB_USER postgres
wf config set DB_PASSWORD your_password

# Docker settings
wf config set USE_DOCKER true
wf config set DOCKER_POSTGRES_CONTAINER vnext-postgres

# Auto discovery
wf config set AUTO_DISCOVER true
```

---

## 🆘 Troubleshooting

### "Files not found" (When using on another PC)
```bash
# Check current config
wf config get PROJECT_ROOT

# Set new PC's path
wf config set PROJECT_ROOT /Users/NewUser/path/to/project

# Verify
wf check
```

### "Cannot connect to API"
```bash
# Check API
curl http://localhost:4201/api/v1/health

# Check config
wf config get API_BASE_URL
```

### "Database connection failed"
```bash
# Check Docker container
docker ps | grep postgres

# Start container
docker start vnext-postgres

# Check config
wf config get USE_DOCKER
wf config get DOCKER_POSTGRES_CONTAINER
```

### "npm link not working"
```bash
# Use alias
echo 'alias wf="node $(pwd)/bin/workflow.js"' >> ~/.bashrc
source ~/.bashrc
```

---

## 🚀 Creating a New Version

The project uses automated versioning and publishing via GitHub Actions. Follow these steps to create and publish a new version:

### Method 1: Using Release Branches (Recommended)

1. **Create a release branch** following the pattern `release-vX.Y`:
   ```bash
   git checkout -b release-v1.0
   git push origin release-v1.0
   ```

2. **Push to the release branch** - The workflow will automatically:
   - Calculate the next patch version (e.g., `1.0.0`, `1.0.1`, `1.0.2`)
   - Build and validate the package
   - Publish to NPM and/or GitHub Packages
   - Create a Git tag (e.g., `v1.0.0`)
   - Create a GitHub release

### Method 2: Manual Workflow Dispatch

1. **Go to GitHub Actions** in your repository
2. **Select "Build and Publish to NPM"** workflow
3. **Click "Run workflow"**
4. **Configure options**:
   - **Version Override**: Optional. Leave empty for auto-calculation (e.g., `1.0.6`)
   - **Force Publish**: Set to `true` if you want to republish an existing version
   - **Target Registry**: Choose `npmjs`, `github`, or `both`
5. **Click "Run workflow"**

### Version Calculation

The workflow automatically calculates versions:

- **From branch name**: If branch is `release-v1.0`, it will find the next available patch version (e.g., `1.0.0`, `1.0.1`, `1.0.2`)
- **From package.json**: If branch doesn't match the pattern, it increments the patch version from `package.json`

### After Publishing

Once published, the new version will be:
- ✅ Available on NPM: `npm install -g @burgan-tech/vnext-workflow-cli@1.0.0`
- ✅ Tagged in Git: `v1.0.0`
- ✅ Released on GitHub with release notes

### Workflow Requirements

The workflow requires these secrets to be configured in GitHub repository settings:

- **NPM_TOKEN** (optional): For publishing to NPM. If not set, only GitHub Packages will be used.
- **SONAR_TOKEN** (optional): For code quality analysis
- **SONAR_HOST_URL** (optional): SonarQube server URL

### Workflow Steps

The build and publish workflow performs these steps:

1. ✅ **Checkout code** with full Git history
2. ✅ **Calculate version** from branch or package.json
3. ✅ **Validate syntax** - Checks all JavaScript files
4. ✅ **Run linting** (if available)
5. ✅ **Run tests** (if available)
6. ✅ **Build package** (if build script exists)
7. ✅ **Publish to registry** (NPM and/or GitHub Packages)
8. ✅ **Create Git tag** (e.g., `v1.0.0`)
9. ✅ **Create GitHub release** with release notes

---

## 📋 Development

### Project Structure

```
vnext-workflow-cli/
├── bin/
│   └── workflow.js          # CLI entry point
├── src/
│   ├── commands/            # Command implementations
│   │   ├── check.js
│   │   ├── config.js
│   │   ├── csx.js
│   │   ├── reset.js
│   │   ├── sync.js
│   │   └── update.js
│   └── lib/                 # Library modules
│       ├── api.js
│       ├── config.js
│       ├── csx.js
│       ├── db.js
│       ├── discover.js
│       └── workflow.js
├── .github/
│   └── workflows/           # GitHub Actions workflows
│       ├── build-and-publish.yml
│       └── check-sonar.yml
├── package.json
└── README.md
```

### Local Development

```bash
# Clone and install
git clone https://github.com/burgan-tech/vnext-workflow-cli.git
cd vnext-workflow-cli
npm install
npm link

# Test the CLI
wf --version
wf check

# Run development
npm run dev
```