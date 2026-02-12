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

## 📄 vnext.config.json (Required)

Every vNext project must have a `vnext.config.json` file in the **project root**. This file defines the domain and component paths.

### Example Configuration

```json
{
  "version": "1.0.0",
  "domain": "core",
  "paths": {
    "componentsRoot": "core",
    "tasks": "Tasks",
    "views": "Views",
    "functions": "Functions",
    "extensions": "Extensions",
    "workflows": "Workflows",
    "schemas": "Schemas"
  }
}
```

### Key Properties

| Property | Description |
|----------|-------------|
| `domain` | Domain name used for API calls (replaces config's API_DOMAIN) |
| `paths.componentsRoot` | Root folder where all components are located |
| `paths.tasks` | Tasks folder name under componentsRoot |
| `paths.workflows` | Workflows folder name under componentsRoot |
| `paths.schemas` | Schemas folder name under componentsRoot |
| `paths.views` | Views folder name under componentsRoot |
| `paths.functions` | Functions folder name under componentsRoot |
| `paths.extensions` | Extensions folder name under componentsRoot |

### Component Discovery

The CLI scans `componentsRoot` recursively and:
- Includes all `.json` files in subfolders
- Ignores `.meta` folders
- Ignores `*.diagram.json` files
- Ignores `package*.json` and `*config*.json` files

---

## ⚡ Quick Start

### Initial Configuration

After installation, navigate to your vNext project and run:

```bash
# Go to your vNext project directory
cd /path/to/your/vnext-project

# Database settings (if using Docker)
wf config set USE_DOCKER true
wf config set DOCKER_POSTGRES_CONTAINER vnext-postgres

# Verify configuration
wf check
```

**Note:** The CLI automatically uses the current working directory as the project root. Just `cd` into your project folder before running commands.

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

**Purpose**: System health check

Checks and displays:
- vnext.config.json status and domain info
- API connection status
- Database connection status
- Component folders found

```bash
wf check
```

---

### `wf sync`

**Purpose**: Add missing components to database (skip existing)

**What it does**:
1. Scans all CSX files and updates JSON files with base64 encoded content
2. For each component JSON file:
   - Checks if it exists in DB (by key)
   - If **exists** → Skip (already synced)
   - If **not exists** → Publish to API
3. Re-initializes the system

**Use when**: Initial setup, adding new components without affecting existing ones

```bash
wf sync
```

---

### `wf update [options]`

**Purpose**: Update changed components (delete + re-add)

**What it does**:
1. Finds changed CSX files (Git) and updates JSON files
2. For each component JSON file:
   - Checks if it exists in DB (by key)
   - If **exists** → Delete from DB, then publish to API
   - If **not exists** → Publish to API
3. Re-initializes the system

**Use when**: You modified existing components and want to update them

```bash
wf update                # Process changed files in Git (CSX + JSON)
wf update --all          # Update all (asks for confirmation)
wf update --file x.json  # Process a single file
```

---

### `wf reset`

**Purpose**: Force reset components (always delete + re-add)

**What it does**:
1. Shows interactive menu to select component type
2. For each component JSON file:
   - Checks if it exists in DB (by key)
   - If **exists** → Delete from DB, then publish to API
   - If **not exists** → Publish to API
3. Re-initializes the system

**Use when**: You need to force reset components regardless of changes

```bash
wf reset  # Select folder from interactive menu
```

**Menu Options**:
```
? Which folder should be reset?
❯ tasks (Tasks/)
  views (Views/)
  functions (Functions/)
  extensions (Extensions/)
  workflows (Workflows/)
  schemas (Schemas/)
  ──────────────
  TUMU (All folders)
```

---

### `wf csx [options]`

**Purpose**: Convert CSX files to Base64 and embed in JSON files

**What it does**:
1. Finds CSX files (changed or all)
2. Converts to Base64
3. Updates ALL JSON files that reference the CSX file
4. Updates ALL matching `location` references in each JSON

**Use when**: You only want to update CSX content in JSONs without publishing to API

```bash
wf csx              # Process changed files in Git
wf csx --all        # Process all CSX files
wf csx --file x.csx # Process a single file
```

---

### `wf config <action> [key] [value]`

**Purpose**: Configuration management

```bash
wf config get              # Show all settings (active domain)
wf config get PROJECT_ROOT # Show a specific setting
wf config set DB_PASSWORD pass # Change a setting (on active domain)
```

**Note:** `config get` and `config set` always operate on the **active domain**. Use `wf domain use <name>` to switch domains.

---

### `wf domain [action] [name] [options]`

**Purpose**: Multidomain management

Manage multiple domain configurations. Switch between domains with a single command. All CLI commands automatically use the active domain's settings.

```bash
# Show active domain name
wf domain active

# List all domains
wf domain list
wf domain --list

# Add a new domain
wf domain add staging --API_BASE_URL http://staging.example.com:4201 --DB_NAME vNext_StagingDb

# Add a domain with multiple settings
wf domain add production \
  --API_BASE_URL http://prod.example.com:4201 \
  --DB_NAME vNext_ProdDb \
  --DB_HOST prod-db.example.com \
  --DB_USER prod_user \
  --DB_PASSWORD prod_pass

# Switch active domain
wf domain use staging

# Remove a domain
wf domain remove staging
```

**Notes:**
- When adding a domain, any unspecified settings are inherited from the `default` domain.
- The `default` domain cannot be removed.
- If the active domain is removed, the CLI automatically switches to `default`.

---

## ⚙️ Configuration Variables

Config file location: `~/.config/vnext-workflow-cli/config.json`

### Config File Format

The config file uses a domain-aware structure. Each domain has its own set of configuration values:

```json
{
  "ACTIVE_DOMAIN": "default",
  "DOMAINS": [
    {
      "DOMAIN_NAME": "default",
      "AUTO_DISCOVER": true,
      "API_BASE_URL": "http://localhost:4201",
      "API_VERSION": "v1",
      "DB_HOST": "localhost",
      "DB_PORT": 5432,
      "DB_NAME": "vNext_WorkflowDb",
      "DB_USER": "postgres",
      "DB_PASSWORD": "postgres",
      "USE_DOCKER": false,
      "DOCKER_POSTGRES_CONTAINER": "vnext-postgres",
      "DEBUG_MODE": false
    }
  ]
}
```

### All Available Settings (Per Domain)

| Variable | Default | Description |
|----------|---------|-------------|
| `PROJECT_ROOT` | `process.cwd()` | **Auto.** Always uses current working directory (cannot be changed) |
| `AUTO_DISCOVER` | `true` | Enable automatic component folder discovery |
| `API_BASE_URL` | `http://localhost:4201` | vNext API base URL |
| `API_VERSION` | `v1` | API version |
| `DB_HOST` | `localhost` | PostgreSQL host |
| `DB_PORT` | `5432` | PostgreSQL port |
| `DB_NAME` | `vNext_WorkflowDb` | PostgreSQL database name |
| `DB_USER` | `postgres` | PostgreSQL username |
| `DB_PASSWORD` | `postgres` | PostgreSQL password |
| `USE_DOCKER` | `false` | Use Docker for PostgreSQL connection |
| `DOCKER_POSTGRES_CONTAINER` | `vnext-postgres` | Docker container name for PostgreSQL |
| `DEBUG_MODE` | `false` | Enable debug logging |

**Note:** `PROJECT_ROOT` is always the current working directory (`process.cwd()`). Simply `cd` into your project folder before running any command.

### Quick Setup Examples

```bash
# API settings (applied to active domain)
wf config set API_BASE_URL http://localhost:4201
wf config set API_VERSION v1

# Database settings (direct connection)
wf config set DB_HOST localhost
wf config set DB_PORT 5432
wf config set DB_NAME vNext_WorkflowDb
wf config set DB_USER postgres
wf config set DB_PASSWORD your_password
wf config set USE_DOCKER false

# Database settings (Docker)
wf config set USE_DOCKER true
wf config set DOCKER_POSTGRES_CONTAINER vnext-postgres

# Other settings
wf config set AUTO_DISCOVER true
wf config set DEBUG_MODE false
```

---

## 💡 Usage Scenarios

### 1. First Time Setup
```bash
# Go to your vNext project
cd /path/to/project

# Check system status
wf check

# Sync all components (add missing ones)
wf sync
```

### 2. Daily Development - Changed Files
```bash
# Edit CSX or JSON files
vim MyTask.csx

# Update only changed components
wf update
```

### 3. Update All Components
```bash
# Force update all components
wf update --all
```

### 4. Reset Specific Component Type
```bash
# Interactive menu
wf reset
```

### 5. Only Update CSX in JSONs (No API)
```bash
# Update CSX content in JSON files without publishing
wf csx
```

### 6. Multidomain Workflow
```bash
# Add domains
wf domain add domain-a --API_BASE_URL http://localhost:4201 --DB_NAME vNext_DomainA
wf domain add domain-b --API_BASE_URL http://localhost:4221 --DB_NAME vNext_DomainB

# Work on Domain A
wf domain use domain-a
wf check
wf update

# Switch to Domain B - config is applied automatically
wf domain use domain-b
wf check
wf update

# See all domains
wf domain list
```

---

## 🔄 Command Comparison

| Command | DB Check | Existing Action | New Action | Use Case |
|---------|----------|-----------------|------------|----------|
| `sync` | Yes | Skip | Publish | Add missing components |
| `update` | Yes | Delete + Publish | Publish | Update changed components |
| `reset` | Yes | Delete + Publish | Publish | Force reset components |
| `csx` | No | N/A | N/A | Only update CSX in JSONs |

---

## 🔀 Multidomain Support

### Overview

The CLI supports managing multiple domain configurations. Each domain has its own `API_BASE_URL`, `DB_NAME`, and other settings. Switch between domains with a single command.

### Backward Compatibility

- Existing single-domain configurations are automatically migrated to the new format.
- A `default` domain is created with your existing settings.
- If you don't use multidomain features, everything works exactly as before.
- All `wf config get/set` commands continue to work (they operate on the active domain).

### Migration

When upgrading from an older version, the CLI automatically migrates the config file:

**Before (old flat format):**
```json
{
  "API_BASE_URL": "http://localhost:4201",
  "DB_NAME": "vNext_WorkflowDb"
}
```

**After (new domain-aware format):**
```json
{
  "ACTIVE_DOMAIN": "default",
  "DOMAINS": [
    {
      "DOMAIN_NAME": "default",
      "AUTO_DISCOVER": true,
      "API_BASE_URL": "http://localhost:4201",
      "API_VERSION": "v1",
      "DB_HOST": "localhost",
      "DB_PORT": 5432,
      "DB_NAME": "vNext_WorkflowDb",
      "DB_USER": "postgres",
      "DB_PASSWORD": "postgres",
      "USE_DOCKER": false,
      "DOCKER_POSTGRES_CONTAINER": "vnext-postgres",
      "DEBUG_MODE": false
    }
  ]
}
```

Your existing values are preserved. Any missing keys are filled in from defaults (11 keys total).

No manual action is required. The migration happens automatically on first run.

### Domain Commands

| Command | Description |
|---------|-------------|
| `wf domain active` | Show active domain name |
| `wf domain list` | List all domains with active indicator |
| `wf domain --list` | List all domains (shorthand) |
| `wf domain add <name> [options]` | Add a new domain |
| `wf domain use <name>` | Switch active domain |
| `wf domain remove <name>` | Remove a domain |

### Available Options for `wf domain add`

| Option | Description |
|--------|-------------|
| `--API_BASE_URL <url>` | API base URL |
| `--API_VERSION <version>` | API version |
| `--DB_HOST <host>` | Database host |
| `--DB_PORT <port>` | Database port |
| `--DB_NAME <name>` | Database name |
| `--DB_USER <user>` | Database user |
| `--DB_PASSWORD <password>` | Database password |
| `--AUTO_DISCOVER <true/false>` | Auto discover components |
| `--USE_DOCKER <true/false>` | Use Docker for DB |
| `--DOCKER_POSTGRES_CONTAINER <name>` | Docker container name |
| `--DEBUG_MODE <true/false>` | Debug mode |

Unspecified options inherit from the `default` domain.

---

## 🆘 Troubleshooting

### "vnext.config.json not found"
```bash
# Make sure you're in the correct directory
pwd

# Check if vnext.config.json exists
ls -la vnext.config.json

# Check current working directory
wf config get PROJECT_ROOT
```

### "Files not found" (When using on another PC)
```bash
# Just cd into the project directory
cd /Users/NewUser/path/to/project

# Verify
wf check
```

**Note:** No need to set PROJECT_ROOT - just `cd` into your project folder.

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
│   │   ├── domain.js        # Multidomain management
│   │   ├── reset.js
│   │   ├── sync.js
│   │   └── update.js
│   └── lib/                 # Library modules
│       ├── api.js           # API client (publish, reinitialize)
│       ├── config.js        # CLI configuration
│       ├── csx.js           # CSX processing
│       ├── db.js            # Database operations
│       ├── discover.js      # Component discovery
│       ├── vnextConfig.js   # vnext.config.json reader
│       └── workflow.js      # Workflow processing
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

---

## 📝 License

MIT License - see [LICENSE](LICENSE) for details.
