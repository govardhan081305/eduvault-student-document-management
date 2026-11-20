# Frontend – EduVault Web App

A static single-page app (HTML + CSS + vanilla JavaScript). No build step, no frameworks.

```
frontend/
├── index.html        # Markup for login, dashboard, documents, upload and profile views
├── css/
│   └── styles.css    # All styling (responsive)
└── js/
    ├── config.js     # >>> put your Lambda Function URL here <<<
    └── app.js        # App logic: auth, API calls, rendering, uploads
```

## Configure
Open `js/config.js` and set:

```js
const API = "https://xxxxxxxx.lambda-url.ap-south-1.on.aws/";
```

## Run locally
```bash
cd frontend
python -m http.server 8000
# open http://localhost:8000
```
(Your Lambda Function URL must allow CORS from the origin you use.)

## Host
Upload the contents of this folder to an S3 bucket with **Static website hosting** enabled (or any static host such as GitHub Pages, Netlify or CloudFront).
