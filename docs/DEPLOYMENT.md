# Deployment Guide (AWS Console)

Region used in this project: **ap-south-1 (Mumbai)**. Any region works – just keep all resources in the same one.

## 1. S3 bucket (file storage)
1. Create a bucket, e.g. `eng23cs0069-student-docs`.
2. Keep **Block all public access = ON** (files are served only through pre-signed links).
3. Bucket → **Permissions → CORS** → paste [`backend/s3-cors.json`](../backend/s3-cors.json).
   It allows only the live site (`https://https://d1qub8ki2toxxc.cloudfront.net/`) and `http://localhost:8000` for local testing. Origins must have **no trailing slash and no path**.

## 2. DynamoDB tables
| Table | Partition key | Sort key |
|-------|---------------|----------|
| `student-users` | `studentId` (String) | – |
| `student-documents` | `studentId` (String) | `docId` (String) |

Use on-demand capacity.

## 3. IAM role for Lambda
Create a role for Lambda and attach the policy in [`backend/iam-policy.json`](../backend/iam-policy.json)
(replace `YOUR_BUCKET_NAME` and `YOUR_ACCOUNT_ID`).

## 4. Lambda function
1. Create function `student-docs`, runtime **Python 3.12**, use the role above.
2. Paste the code from [`backend/lambda_function.py`](../backend/lambda_function.py) and **Deploy**.
3. Configuration → Environment variables:
   `BUCKET_NAME`, `TABLE_NAME`, `USERS_TABLE`, `SECRET_KEY` (see [`backend/.env.example`](../backend/.env.example)).
4. Increase timeout to ~10 s (default 3 s can be tight for password hashing).
5. Configuration → **Function URL** → Create, auth type **NONE**, enable **CORS**: allow origin `https://d1qub8ki2toxxc.cloudfront.net/` (add `http://localhost:8000` while testing), allow method `POST`, allow header `content-type`.
6. Copy the Function URL.

## 5. Frontend
1. Edit [`frontend/js/config.js`](../frontend/js/config.js) and paste the Function URL.
2. Host the `frontend/` folder on **S3 + CloudFront** (live site: https://d1qub8ki2toxxc.cloudfront.net/):
   - Upload `index.html`, `css/` and `js/` to a **separate** S3 bucket from the document bucket.
   - Create a CloudFront distribution with that bucket as origin and set `index.html` as the default root object.
   - After uploading new files, create a CloudFront **invalidation** for `/*` so changes appear immediately.

## 6. Test
Register → login → upload → preview/download → delete. Check **CloudWatch → Log groups → /aws/lambda/student-docs** for activity logs.

## Troubleshooting
| Symptom | Likely cause |
|---------|--------------|
| "Network/CORS error" on upload | S3 CORS not set, or bucket/region mismatch |
| Browser CORS error on login | Function URL CORS not enabled, or its allowed origin does not exactly match `https://d1qub8ki2toxxc.cloudfront.net/` |
| Old page still showing after update | CloudFront cache – create an invalidation for `/*` |
| "Server not configured" | `SECRET_KEY` missing or shorter than 8 characters |
| Preview opens "Access denied" | Link older than 5 minutes – click again |
| Lambda timeout | Raise timeout to 10 s |