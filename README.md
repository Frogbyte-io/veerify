# Veerify

[![CI](https://github.com/Frogbyte-io/veerify/actions/workflows/ci.yml/badge.svg)](https://github.com/Frogbyte-io/veerify/actions/workflows/ci.yml)

A modern feedback management platform built with Nuxt 3, TypeScript, and shadcn-vue. Veerify helps you collect, organize, and prioritize user feedback to build better products - similar to Sleekplan, Canny, and Featurebase.

## 🌟 Features

- **Feedback Collection** - Capture user feedback and feature requests
- **Voting System** - Let users upvote their favorite features
- **Status Management** - Track feedback from submission to completion
- **Team Collaboration** - Role-based access with team management
- **Analytics Dashboard** - Insights into user engagement and feedback trends
- **Public Roadmap** - Share your product development timeline
- **User Management** - Organize and segment your user base

## 🐸 Tech Stack (FrogStack)

- **[Nuxt 3](https://nuxt.com/)** - The Intuitive Vue Framework
- **[TypeScript](https://www.typescriptlang.org/)** - Static type checking
- **[shadcn-vue](https://www.shadcn-vue.com/)** - Beautifully designed components built with Radix Vue and Tailwind CSS
- **[Tailwind CSS](https://tailwindcss.com/)** - Utility-first CSS framework
- **[Vue 3](https://vuejs.org/)** - The Progressive JavaScript Framework
- **[Reka UI](https://www.reka-ui.com/)** - Vue port of Radix UI primitives
- **[Lucide Vue](https://lucide.dev/guide/packages/lucide-vue-next)** - Beautiful hand-crafted SVG icons
- **[VueUse](https://vueuse.org/)** - Collection of essential Vue composition utilities

## 🚀 Getting Started

### Prerequisites

- Node.js 18+
- Yarn package manager

### Installation

Install dependencies using yarn:

```bash
yarn install
```

### Agent harness (Codex/Claude)

The repository includes an explicit AI harness so coding agents can bootstrap context and run deterministic checks.

```bash
# Print key context and git snapshot
yarn harness:context

# Validate agent docs map + run quality gates
yarn harness:verify
```

`yarn harness:verify` runs:
- `yarn typecheck`
- `yarn test`
- `yarn lint`
- `yarn test:e2e:if-available` (guarded Playwright runner)

Chrome DevTools MCP for Codex:

```bash
# One-time local setup
yarn codex:mcp:chrome:setup

# Deterministic per-worktree app URL/port
yarn worktree:env

# Run app bound to the worktree-specific port
yarn dev:worktree
```

### Development

#### Start the development server on `http://localhost:3000`:

```bash
yarn dev
```

#### Start the development PostgreSQL database

```bash
docker compose -f docker-compose-dev.yml up -d
```

#### Email Testing with Mailpit

The development environment includes [Mailpit](https://mailpit.axllent.io/), a local SMTP server and web interface for testing emails during development.

When you run the development docker compose, Mailpit will be available at:

- **Web Interface**: [http://localhost:8025](http://localhost:8025) - View sent emails in a web UI
- **SMTP Server**: `localhost:1025` - Configure your app to send emails here

**SMTP Configuration for Development:**

Create a `.env` file in your project root with these settings:

```env
# Email Configuration for Mailpit (Development)
MAIL_FROM="noreply@veerify.local"
SMTP_HOST=localhost
SMTP_PORT=1025
SMTP_SECURE=false
SMTP_USER=
SMTP_PASS=
```

All emails sent by your application during development will be captured by Mailpit and displayed in the web interface, making it easy to test email verification, password resets, and other email functionality without sending real emails.

#### Visualize the database using drizzle studio

```bash
yarn db:studio
```

### Production

#### Build the application for production:

```bash
yarn build
```

The build automatically runs migrations and seeds test data via the `postbuild` script. Seed is skipped on production (`VERCEL_ENV=production`).

#### Configure the PostgreSQL database

You can connect to PostgreSQL in two ways:

**Option A — single connection string (recommended for hosted databases like Neon):**

```env
DATABASE_URL=postgres://user:password@host:5432/dbname?sslmode=require
```

**Option B — individual variables (used by local Docker setup):**

```env
PGHOST=localhost
PGPORT=5432
PGUSER=veerify
PGPASSWORD=veerifypassword
PGDATABASE=veerifydb
```

`DATABASE_URL` takes precedence when both are set.

For local development, start the database with Docker Compose:

```bash
docker compose up -d
```

#### Preview the production build locally:

```bash
yarn preview
```


**Test credentials on preview deployments:**

Two seed accounts are available — one with a full org/team/project setup, one standalone personal account with no org affiliation:

| Account  | Email                    | Password      | Has org? |
| -------- | ------------------------ | ------------- | -------- |
| Org user | `test@preview.local`     | `password123` | Yes      |
| Personal | `personal@preview.local` | `password123` | No       |

## 📁 Project Structure

```
veerify/
├── components/
│   ├── sidebar/           # Navigation components
│   └── ui/               # shadcn-vue UI components
├── layouts/
│   ├── clean.vue         # Clean layout for auth pages
│   └── dashboard.vue     # Main dashboard layout
├── pages/
│   ├── dashboard/        # Main dashboard
│   ├── feedback/         # Feedback management
│   ├── team/            # Team management
│   ├── reports/         # Analytics and reporting
│   ├── help/            # Help center
│   └── settings/        # Application settings
├── scripts/
│   └── seed.ts          # Preview database seed (org user + personal user)
└── assets/css/          # Global styles
```

## 🎨 UI Components (shadcn-vue)

This project uses [shadcn-vue](https://www.shadcn-vue.com/) for UI components. shadcn-vue provides beautifully designed, accessible components that you can copy and paste into your apps.

### How shadcn-vue Works

Unlike traditional component libraries, shadcn-vue components are **not installed as dependencies**. Instead, you copy the source code directly into your project. This gives you:

- **Full ownership** of the code - modify components as needed
- **No vendor lock-in** - components live in your codebase
- **Customizable** - easily adapt components to your design system
- **Tree-shakable** - only include what you use

### Adding Components

To add a new shadcn-vue component to your project, use the CLI:

```bash
# Add a specific component
npx shadcn-vue@latest add button

# Add multiple components
npx shadcn-vue@latest add button card dialog

# List all available components
npx shadcn-vue@latest list
```

Components will be added to the `components/ui/` directory and can be used like any other Vue component. There is no need to import them, as they are automatically imported by Nuxt.

```vue
<template>
  <div>
    <Button variant="default">Submit Feedback</Button>
    <Button variant="destructive">Delete</Button>
    <Button variant="outline" size="sm">Vote</Button>
  </div>
</template>
```

### Component Configuration

The shadcn-vue configuration is stored in `components.json`:

- **Style**: New York design system
- **TypeScript**: Fully typed components
- **Tailwind**: Custom CSS variables for theming
- **Icons**: Lucide icon library integration

## 🔧 Available Pages

- **Dashboard** (`/dashboard`) - Overview of feedback metrics and activity
- **Feedback** (`/feedback`) - Main feedback management interface
- **Analytics** (`/reports`) - Detailed analytics and insights
- **Team** (`/team`) - Team member management and permissions
- **Help Center** (`/help`) - User documentation and support
- **Settings** (`/settings`) - Application configuration

## 🤝 Contributing

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add some amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## 📚 Learn More

- [Nuxt 3 Documentation](https://nuxt.com/docs/getting-started/introduction)
- [shadcn-vue Documentation](https://www.shadcn-vue.com/)
- [Tailwind CSS Documentation](https://tailwindcss.com/docs)
- [Vue 3 Documentation](https://vuejs.org/guide/)
