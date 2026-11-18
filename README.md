# WasteWise AI — Public Web App

A responsive waste-classification app using Gemini Vision. This project can be deployed as one public web service so anyone with the public URL can open it. It does not use random/demo classifications.

## Deploy so everyone can use it

### 1. Create a Gemini API key
Create a key in Google AI Studio: https://aistudio.google.com/app/apikey

### 2. Put this project on GitHub
- Extract this ZIP.
- Create a new GitHub repository.
- Upload all files and folders from this project to the repository.

### 3. Deploy on Render
- Sign in at https://render.com/
- Choose **New → Blueprint** (or **New → Web Service**).
- Connect the GitHub repository containing this project.
- If using Blueprint, Render reads `render.yaml`.
- Add the environment variable `GEMINI_API_KEY` in the Render service settings. Paste your Gemini key as its value. Do not put the key in frontend files or commit it to GitHub.
- Deploy and wait for the service to become **Live**.

### 4. Share the public URL
Render will provide a URL similar to `https://your-app-name.onrender.com`. Share that URL; visitors can open the app without installing Node.js or downloading this project.

## Local development
Requires Node.js 18+.
1. Run `npm install`
2. Copy `.env.example` to `.env`
3. Add `GEMINI_API_KEY=your_key_here` to `.env`
4. Run `npm start`
5. Open `http://localhost:3000`

## Included features
- Image upload and drag-and-drop
- Camera capture (HTTPS or localhost required by browsers)
- Gemini Vision classification and disposal guidance
- Dashboard and local browser scan history
- Responsive desktop/mobile layout

## Important deployment notes
- This ZIP is deployment-ready, but it has **not** been published to a public URL. Publishing requires access to your GitHub and hosting accounts and your API key; I cannot sign in to those accounts or create those credentials for you from this chat.
- Free hosting services may sleep when idle, so the first visit after inactivity can take longer.
- Gemini API usage may have quotas or charges depending on the account and current plan. Check Google's current terms and usage limits.
- Uploaded images are sent to Google's Gemini API for analysis. Scan history is stored in each visitor's own browser, not in a shared database.
- For a public launch, add rate limiting, abuse protection, monitoring, and privacy/terms pages. Keep the API key private.
- Bin colours and disposal rules vary by municipality. Follow local collection guidelines.
