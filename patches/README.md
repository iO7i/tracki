# PostgreSQL connection-loss guard

`postgres@3.4.9.patch` rejects execution on a closed/destroyed socket before buffering a write, in both ESM and CommonJS builds. The real worker-connection termination regression exposed a rollback write against a closed socket (`nextWrite` null dereference), followed by a stalled pool shutdown. See the related [upstream report](https://github.com/porsager/postgres/issues/1066).

The patch does not acknowledge or swallow failed queries: they reject with `CONNECTION_CLOSED`. PostgreSQL releases transaction ownership; the durable inbox retains the item for retry. The integration suite must remain enabled when upgrading/removing this patch. Shutdown also has a five-second pool-close deadline. Versions remain pinned by the lockfile; this is not a general dependency upgrade.
