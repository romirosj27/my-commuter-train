# Private Redis for BullMQ on Fly.io: persisted to a volume (append-only file),
# never evicts keys (BullMQ requires noeviction), password-protected, and
# listening on IPv6 for Fly's private network. It has no public address.
FROM redis:7-alpine
CMD ["sh", "-c", "exec redis-server --dir /data --appendonly yes --appendfsync everysec --maxmemory-policy noeviction --bind 0.0.0.0 :: --protected-mode no --requirepass \"$REDIS_PASSWORD\""]
