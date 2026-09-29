#!/usr/bin/env python3
"""Helpers for the Redis backup runner: S3 upload and success-metadata read.

Secrets arrive only through environment variables; nothing here logs them.
"""
import os
import sys
from datetime import datetime, timedelta, timezone

import boto3


def _client():
    return boto3.client(
        "s3",
        endpoint_url=os.environ["BACKUP_ENDPOINT"],
        region_name=os.environ.get("BACKUP_REGION", "us-east-1"),
        aws_access_key_id=os.environ["BACKUP_ACCESS_KEY_ID"],
        aws_secret_access_key=os.environ["BACKUP_SECRET_ACCESS_KEY"],
    )


def upload(src: str) -> None:
    bucket = os.environ["BACKUP_BUCKET"]
    key = os.path.basename(src)
    client = _client()
    # One timestamped object per successful run; provider lifecycle (30 days)
    # expires old snapshots, so the credential needs no delete access.
    client.upload_file(src, bucket, key)


def last_success_age_seconds(state_file: str) -> int:
    try:
        with open(state_file, encoding="ascii") as handle:
            stamp = handle.read().strip()
        parsed = datetime.strptime(stamp, "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=timezone.utc)
    except (OSError, ValueError):
        return 2**63 - 1
    return int((datetime.now(timezone.utc) - parsed).total_seconds())


if __name__ == "__main__":
    command = sys.argv[1] if len(sys.argv) > 1 else ""
    if command == "upload":
        src = os.environ["SRC"]
        upload(src)
    elif command == "age-seconds":
        print(last_success_age_seconds(sys.argv[2]))
    else:
        print(f"unknown command: {command!r}", file=sys.stderr)
        sys.exit(2)
