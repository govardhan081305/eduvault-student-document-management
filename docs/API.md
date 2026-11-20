# API Reference

Single endpoint: the Lambda **Function URL**. All calls are `POST` with a JSON body and an `action` field.
Every action except `register` and `login` must include the `token` returned at login.

| Action | Auth | Body fields | Success response |
|--------|------|-------------|------------------|
| `register` | No | `name`, `studentId`, `email`, `department`, `password` | `{ token, user }` |
| `login` | No | `studentId`, `password` | `{ token, user }` |
| `upload` | Yes | `fileName`, `contentType`, `category`, `size` | `{ docId, upload: { url, fields } }` (pre-signed S3 POST, valid 5 min) |
| `list` | Yes | – | `{ documents: [ { docId, fileName, category, contentType, size, uploadedAt } ] }` |
| `view` | Yes | `docId` | `{ url }` – pre-signed GET, opens inline (5 min) |
| `download` | Yes | `docId` | `{ url }` – pre-signed GET, forces download (5 min) |
| `delete` | Yes | `docId` | `{ deleted: docId }` |

## Errors
| Status | Meaning |
|--------|---------|
| 400 | Invalid request, missing field, bad email, short password, file too large/empty, unknown action |
| 401 | Wrong credentials, or missing/expired/invalid token |
| 404 | Document not found (or not owned by the caller) |
| 409 | Student ID already registered |
| 500 | `SECRET_KEY` not configured |

## Example
```bash
curl -X POST "$API_URL" \
  -H "Content-Type: application/json" \
  -d '{"action":"login","studentId":"ENG23CS0069","password":"your-password"}'
```

## Upload flow
1. Client calls `upload` → Lambda saves metadata in DynamoDB and returns a pre-signed POST.
2. Client sends the file **directly to S3** using the returned `url` and `fields` (multipart form, `file` field last).
3. Client calls `list` to refresh.
