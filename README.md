# Kaizen App

A Node.js + Express + PostgreSQL application.

## Project Structure

```
.
├── .env.example          # Example environment variables
├── .gitignore            # Git ignore rules
├── .editorconfig         # Code style configuration
├── package.json          # Project dependencies and scripts
├── README.md             # This file
├── migrations/           # Database migration files
├── scripts/              # Utility scripts
├── src/
│   ├── config/           # Configuration files
│   ├── middleware/       # Express middleware
│   ├── routes/           # Route handlers
│   ├── services/         # Business logic
│   └── index.js          # Entry point
```

## Getting Started

1. Install dependencies:
```bash
npm install
```

2. Copy the example environment file and fill in your values:
```bash
cp .env.example .env
```

3. Start the development server:
```bash
npm run dev
```

## Scripts

- `npm run dev` - Start the development server
- `npm start` - Start the production server
- `npm run migrate` - Run database migrations
- `npm run lint` - Lint the code
- `npm run format` - Format the code