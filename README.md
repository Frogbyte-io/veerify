# Veerify

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

### Development

Start the development server on `http://localhost:3000`:

```bash
yarn dev
```

### Production

Build the application for production:

```bash
yarn build
```

Preview the production build locally:

```bash
yarn preview
```

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
