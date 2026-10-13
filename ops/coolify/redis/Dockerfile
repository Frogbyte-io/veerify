# Backup runner for the Coolify Redis stack. Builds a small image with the
# Valkey CLI (for triggering and verifying snapshots), an S3 client, and the
# backup/health scripts from this directory.
FROM debian:12-slim

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
       ca-certificates curl gnupg wget \
    && install -d /usr/share/keyrings \
    && curl -fsSL https://packages.valkey.io/debian/archive.key \
       | gpg --dearmor -o /usr/share/keyrings/valkey-archive-keyring.gpg \
    && echo "deb [signed-by=/usr/share/keyrings/valkey-archive-keyring.gpg] https://packages.valkey.io/debian bookworm main" \
       > /etc/apt/sources.list.d/valkey.list \
    && apt-get update \
    && apt-get install -y --no-install-recommends \
       valkey-tools python3-minimal python3-pip \
    && pip3 install --break-system-packages --no-cache-dir "boto3==1.40.53" \
    && apt-get purge -y gnupg \
    && apt-get autoremove -y \
    && rm -rf /var/lib/apt/lists/*

COPY backup.sh restore-note.sh backup-health /usr/local/bin/
COPY backup-state.py /usr/local/lib/veerify-redis-backup/

RUN chmod 0755 /usr/local/bin/backup.sh /usr/local/bin/restore-note.sh \
    /usr/local/bin/backup-health \
    && mkdir -p /var/lib/veerify-redis-backup

# Run-once-per-invocation loop is internal to backup.sh; the container keeps
# looping so Docker health checks and Coolify status stay meaningful.
ENTRYPOINT ["/usr/local/bin/backup.sh"]
