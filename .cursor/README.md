# Cursor Project Rules Structure

This project uses the new Cursor project rules structure with **MDC format** for better organization and context-specific guidance.

## Structure

```
.cursor/rules/           # Project-wide rules and overview
  project.md            # General patterns, security, architecture

server/.cursor/rules/    # Backend-specific rules
  api.md               # API patterns, database, server-side auth

components/.cursor/rules/ # Frontend-specific rules
  vue.md               # Vue components, UI, client-side patterns
```

## Rule Categories

### Project-wide (`.cursor/rules/`)

- Project overview and architecture with Mermaid diagrams
- Common patterns across the entire codebase
- Security guidelines and migration notes
- Development workflow and best practices

### Server (`server/.cursor/rules/`)

- API route patterns and error handling
- Database schema and Drizzle ORM usage
- Better-Auth server-side integration
- Environment configuration and security

### Components (`components/.cursor/rules/`)

- Vue 3 Options API patterns with examples
- shadcn-vue component usage and styling
- Client-side authentication and navigation
- Icons, loading states, and error handling

## MDC Features

The rules files use **MDC (Markdown Components)** format with:

- `::callout{type="info|warning|danger|note"}` for highlighted information
- `::code-group` for tabbed code examples
- YAML frontmatter for metadata
- Mermaid diagrams for architecture visualization
- Structured examples with best practices

## Benefits

1. **Context-Aware**: Rules apply based on your working directory
2. **Visual**: MDC format with callouts and code groups for better readability
3. **Organized**: Related rules grouped by architectural concern
4. **Scalable**: Easy to add domain-specific rules as the project grows
5. **Maintainable**: Each area has focused, relevant guidance

## Usage

When working in different directories, Cursor automatically applies the most relevant rules:

- **Root directory**: General project patterns and architecture
- **`/server/` directory**: Backend API and database patterns
- **`/components/` directory**: Vue component and UI patterns

This ensures you get contextual AI assistance based on what part of the application you're working on.
