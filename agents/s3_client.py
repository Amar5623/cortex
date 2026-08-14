import os
import boto3

_client = None


def _get_client():
    global _client
    if _client is None:
        _client = boto3.client("s3", region_name=os.environ.get("AWS_REGION", "us-east-1"))
    return _client


def bucket_name() -> str:
    return os.environ["S3_BUCKET_NAME"]


def upload_text(key: str, content: str) -> str:
    """Upload raw text to S3 and return the key. Raises botocore's own
    exception (e.g. AccessDenied) rather than swallowing it -- a failed
    upload should stop the seeding run, not silently skip S3 and leave
    source_s3_key pointing at nothing."""
    client = _get_client()
    client.put_object(
        Bucket=bucket_name(),
        Key=key,
        Body=content.encode("utf-8"),
        ContentType="text/plain",
    )
    return key