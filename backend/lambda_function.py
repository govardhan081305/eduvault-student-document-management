"""
Cloud-Based Student Document Management System - backend (AWS Lambda, Python 3.12)

Environment variables:
  BUCKET_NAME  = your S3 bucket name
  TABLE_NAME   = student-documents
  USERS_TABLE  = student-users
  SECRET_KEY   = any long random text (used to sign login tokens)
"""
import base64
import datetime
import hashlib
import hmac
import json
import os
import re
import time
import uuid

import boto3
from boto3.dynamodb.conditions import Key
from botocore.config import Config

REGION = os.environ.get("AWS_REGION", "ap-south-1")
BUCKET = os.environ["BUCKET_NAME"]
TABLE = os.environ.get("TABLE_NAME", "student-documents")
USERS_TABLE = os.environ.get("USERS_TABLE", "student-users")
SECRET = os.environ.get("SECRET_KEY", "")
MAX_SIZE = 10 * 1024 * 1024          # 10 MB per file
TOKEN_HOURS = 8                      # login session length
CATEGORIES = ["Marksheet", "Certificate", "ID Proof", "Fee Receipt", "Other"]

s3 = boto3.client(
    "s3",
    region_name=REGION,
    endpoint_url=f"https://s3.{REGION}.amazonaws.com",
    config=Config(signature_version="s3v4", s3={"addressing_style": "virtual"}),
)
dynamodb = boto3.resource("dynamodb", region_name=REGION)
docs_table = dynamodb.Table(TABLE)
users_table = dynamodb.Table(USERS_TABLE)


# ---------- helpers ----------
def reply(code, body):
    return {"statusCode": code, "headers": {"Content-Type": "application/json"}, "body": json.dumps(body)}


def clean_id(value):
    return re.sub(r"[^A-Za-z0-9]", "", str(value or "")).upper()[:20]


def hash_password(password, salt=None):
    salt = salt or os.urandom(16).hex()
    digest = hashlib.pbkdf2_hmac("sha256", password.encode(), bytes.fromhex(salt), 100_000).hex()
    return salt, digest


def b64(data):
    return base64.urlsafe_b64encode(data).decode().rstrip("=")


def unb64(text):
    return base64.urlsafe_b64decode(text + "=" * (-len(text) % 4))


def make_token(student_id, name):
    payload = b64(json.dumps({"sid": student_id, "name": name, "exp": int(time.time()) + TOKEN_HOURS * 3600}).encode())
    signature = b64(hmac.new(SECRET.encode(), payload.encode(), hashlib.sha256).digest())
    return f"{payload}.{signature}"


def read_token(token):
    try:
        payload, signature = str(token).split(".")
        expected = b64(hmac.new(SECRET.encode(), payload.encode(), hashlib.sha256).digest())
        if not hmac.compare_digest(signature, expected):
            return None
        data = json.loads(unb64(payload))
        return data if data["exp"] > time.time() else None
    except Exception:
        return None


def now_utc():
    return datetime.datetime.now(datetime.timezone.utc)


# ---------- auth ----------
def register(data):
    student_id = clean_id(data.get("studentId"))
    name = str(data.get("name", "")).strip()[:60]
    email = str(data.get("email", "")).strip()[:100]
    department = str(data.get("department", "")).strip()[:60]
    password = str(data.get("password", ""))
    if not student_id or not name:
        return reply(400, {"error": "Name and Student ID are required"})
    if not re.match(r"^[^@\s]+@[^@\s]+\.[^@\s]+$", email):
        return reply(400, {"error": "Enter a valid email address"})
    if len(password) < 6:
        return reply(400, {"error": "Password must be at least 6 characters"})
    salt, digest = hash_password(password)
    try:
        users_table.put_item(
            Item={
                "studentId": student_id, "name": name, "email": email, "department": department,
                "salt": salt, "passwordHash": digest, "createdAt": now_utc().strftime("%Y-%m-%d"),
            },
            ConditionExpression="attribute_not_exists(studentId)",
        )
    except users_table.meta.client.exceptions.ConditionalCheckFailedException:
        return reply(409, {"error": "This Student ID is already registered. Please log in."})
    print(f"registered student={student_id}")
    return reply(200, {"token": make_token(student_id, name),
                       "user": {"studentId": student_id, "name": name, "email": email, "department": department}})


def login(data):
    student_id = clean_id(data.get("studentId"))
    password = str(data.get("password", ""))
    user = users_table.get_item(Key={"studentId": student_id}).get("Item") if student_id else None
    if not user or not hmac.compare_digest(hash_password(password, user["salt"])[1], user["passwordHash"]):
        print(f"failed login student={student_id}")
        return reply(401, {"error": "Invalid Student ID or password"})
    print(f"login student={student_id}")
    return reply(200, {"token": make_token(student_id, user["name"]),
                       "user": {"studentId": student_id, "name": user["name"],
                                "email": user.get("email", ""), "department": user.get("department", "")}})


# ---------- documents ----------
def upload(student_id, data):
    file_name = re.sub(r"[^A-Za-z0-9._-]", "_", str(data.get("fileName", "file")))[:100]
    content_type = str(data.get("contentType") or "application/octet-stream")[:100]
    category = data.get("category") if data.get("category") in CATEGORIES else "Other"
    size = int(data.get("size", 0))
    if size <= 0 or size > MAX_SIZE:
        return reply(400, {"error": "File must be between 1 byte and 10 MB"})
    doc_id = now_utc().strftime("%Y%m%dT%H%M%S") + "-" + uuid.uuid4().hex[:6]
    s3_key = f"{student_id}/{doc_id}/{file_name}"
    post = s3.generate_presigned_post(
        Bucket=BUCKET, Key=s3_key,
        Fields={"Content-Type": content_type},
        Conditions=[{"Content-Type": content_type}, ["content-length-range", 1, MAX_SIZE]],
        ExpiresIn=300,
    )
    docs_table.put_item(Item={
        "studentId": student_id, "docId": doc_id, "fileName": file_name, "category": category,
        "contentType": content_type, "size": size, "s3Key": s3_key,
        "uploadedAt": now_utc().strftime("%Y-%m-%dT%H:%M:%SZ"),
    })
    print(f"upload student={student_id} file={file_name} size={size}")
    return reply(200, {"docId": doc_id, "upload": post})


def list_docs(student_id):
    items, kwargs = [], {"KeyConditionExpression": Key("studentId").eq(student_id), "ScanIndexForward": False}
    while True:
        page = docs_table.query(**kwargs)
        items += page.get("Items", [])
        if "LastEvaluatedKey" not in page:
            break
        kwargs["ExclusiveStartKey"] = page["LastEvaluatedKey"]
    docs = [{"docId": i["docId"], "fileName": i["fileName"], "category": i["category"],
             "contentType": i.get("contentType", ""), "size": int(i["size"]),
             "uploadedAt": i["uploadedAt"]} for i in items]
    return reply(200, {"documents": docs})


def get_doc(student_id, data):
    return docs_table.get_item(Key={"studentId": student_id, "docId": str(data.get("docId", ""))}).get("Item")


def file_link(student_id, data, inline):
    item = get_doc(student_id, data)
    if not item:
        return reply(404, {"error": "Document not found"})
    disposition = "inline" if inline else f'attachment; filename="{item["fileName"]}"'
    url = s3.generate_presigned_url(
        "get_object",
        Params={"Bucket": BUCKET, "Key": item["s3Key"], "ResponseContentDisposition": disposition,
                "ResponseContentType": item.get("contentType") or "application/octet-stream"},
        ExpiresIn=300,
    )
    print(f"{'view' if inline else 'download'} student={student_id} doc={item['docId']}")
    return reply(200, {"url": url})


def delete_doc(student_id, data):
    item = get_doc(student_id, data)
    if not item:
        return reply(404, {"error": "Document not found"})
    s3.delete_object(Bucket=BUCKET, Key=item["s3Key"])
    docs_table.delete_item(Key={"studentId": student_id, "docId": item["docId"]})
    print(f"delete student={student_id} doc={item['docId']}")
    return reply(200, {"deleted": item["docId"]})


# ---------- entry point ----------
def lambda_handler(event, context):
    if len(SECRET) < 8:
        return reply(500, {"error": "Server not configured: set SECRET_KEY environment variable"})
    try:
        raw = event.get("body") or "{}"
        if event.get("isBase64Encoded"):
            raw = base64.b64decode(raw).decode()
        data = json.loads(raw)
    except Exception:
        return reply(400, {"error": "Invalid request"})

    action = data.get("action")
    if action == "register":
        return register(data)
    if action == "login":
        return login(data)

    session = read_token(data.get("token"))
    if not session:
        return reply(401, {"error": "Session expired. Please log in again."})
    student_id = session["sid"]

    if action == "upload":
        return upload(student_id, data)
    if action == "list":
        return list_docs(student_id)
    if action == "view":
        return file_link(student_id, data, inline=True)
    if action == "download":
        return file_link(student_id, data, inline=False)
    if action == "delete":
        return delete_doc(student_id, data)
    return reply(400, {"error": "Unknown action"})
