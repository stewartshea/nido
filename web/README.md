# Nido Web Client

Frontend service for the Nido app built with SvelteKit.

## Getting Started

### Prerequisites
- Node.js 18+

### Installation
```bash
cd web
npm install
```

### Environment Variables
The web client calls the API **same-origin** by default (`/api/v1`); the Vite
web server proxies `/api` to the API service (`API_PROXY_TARGET`). Optional
`.env` overrides:
```env
PUBLIC_API_URL="http://localhost:3000/api/v1"  # explicit API origin the browser uses (default: same-origin /api/v1)
API_PROXY_TARGET="http://localhost:3000"       # where the web server forwards /api (compose: http://api:3000)
```

### Running Locally
```bash
# Development mode
npm run dev

# Build for production
npm run build

# Preview production build
npm run preview
```

## Features

### Authentication
- User registration and login
- JWT token management
- Protected routes

### Baby Management
- Create and manage baby profiles
- Household organization

### Tracking Features
- Feeding tracking with timer functionality
- Diaper change logging
- Sleep tracking
- Growth monitoring with WHO/CDC comparisons
- Milestone tracking
- Vaccination tracking

### Home & Inventory
- Homes and property assets — registry, cover photos, scoping to a residence
- Meters with interpolated readings; schedules with interval, meter, and seasonal-window triggers
- Maintenance log — cost, consumed stock, receipts; seasonal checklists derived from the log
- Stock items that deplete from logged activity and forecast runout

### Analytics
- Health summaries
- Pattern recognition
- Growth charts


## Visual Identity & UI Style
Nido is calm and trustworthy — a quiet surface you can check at 3am without
glaring light.
- **Palette**: Deep forest greens (primary surfaces, active states) paired with warm brass accents, set against a warm cream "paper" neutral and "char" ink for text.
- **Typography**: Large serif display headings (Lora) combined with a clean sans-serif (Inter) for UI elements, utilizing generous whitespace.
- **Crest**: two marks. The app icon — an egg in a nest (`static/favicon.svg`), drawn in the accent color of the active palette in-app (`lib/components/NidoMark.svelte`) — and the kanji 巣 (*su*: nest), the editorial crest in the README and docs.

## Tech Stack
- SvelteKit
- TypeScript
- Tailwind CSS
- Axios for API communication
- Chart.js for data visualization

## Project Structure
```
src/
├── lib/           # Shared libraries and utilities
│   ├── api.ts     # API client and functions
│   └── stores/    # Application state stores
├── routes/        # Page routes
├── components/    # Reusable components
├── utils/         # Utility functions
└── app.html       # HTML template
```

## License
Apache-2.0