-- A request to connect carries the address it came from, as the trusted proxies resolve it, by
-- which the live requests of one address are bounded (ADR-0047); null where the console could not tell.
ALTER TABLE "connect_requests" ADD COLUMN "client_address" text;
