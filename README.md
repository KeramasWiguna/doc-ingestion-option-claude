This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

## Environment Variables

Copy `.env.local.example` to `.env.local` and fill in:

```bash
ANTHROPIC_API_KEY=
BLOB_READ_WRITE_TOKEN=
```

### Getting an Anthropic API key

1. Go to the [Anthropic Console](https://console.anthropic.com/).
2. Sign up or log in.
3. Navigate to **API Keys** and click **Create Key**.
4. Copy value into `ANTHROPIC_API_KEY`.

Note: requires billing set up (add credits) before key works for requests.

### Getting a Vercel Blob token

1. Go to [Vercel dashboard](https://vercel.com/dashboard) and open (or create) project.
2. Go to **Storage** tab, create a **Blob** store (or select existing one).
3. Open store's **Settings** / **.env.local** tab — copy `BLOB_READ_WRITE_TOKEN`.
4. Paste into `BLOB_READ_WRITE_TOKEN`.

Alternatively via CLI: `vercel env pull .env.local` after linking project and store (`vercel link`, `vercel blob store add`).

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
