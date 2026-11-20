# Backend – AWS Lambda (Python 3.12)

A single Lambda function exposed through a **Function URL**. The frontend sends JSON `POST` requests with an `action` field.

## Files
| File | Purpose |
|------|---------|
| `lambda_function.py` | Lambda handler: register, login, upload, list, view, download, delete |
| `iam-policy.json` | Least-privilege IAM policy for the Lambda execution role |
| `s3-cors.json` | CORS rules for the S3 bucket (needed for browser uploads) |
| `.env.example` | Environment variables the function expects |
| `requirements.txt` | Only for local testing (`boto3` is built into Lambda) |

## Environment variables
| Name | Description |
|------|-------------|
| `BUCKET_NAME` | S3 bucket that stores the files |
| `TABLE_NAME` | DynamoDB documents table (default `student-documents`) |
| `USERS_TABLE` | DynamoDB users table (default `student-users`) |
| `SECRET_KEY` | Long random text used to sign login tokens (min. 8 chars) |

## Actions
See [`../docs/API.md`](../docs/API.md) for request/response examples.

## Deploy
1. Zip is not needed – paste `lambda_function.py` into the Lambda code editor (or upload it as a zip).
2. Runtime: **Python 3.12**, handler: `lambda_function.lambda_handler`.
3. Set the environment variables above.
4. Attach the role described in `iam-policy.json`.
5. Create a **Function URL** (auth type `NONE`, enable CORS) and copy it into `frontend/js/config.js`.

Full steps: [`../docs/DEPLOYMENT.md`](../docs/DEPLOYMENT.md).
