# Security

image-queue is a local, single-user application with access to configured project and reference folders. The local server binds to the loopback interface; API requests with a foreign Host or browser Origin are rejected. Provider keys stay on the server and must not be included in job records, logs, exports or shared configuration. References and image outputs are untrusted files, and file access must stay within configured roots after resolving symbolic links. Optional remote deployments require their own authentication and transport protection; a local setup is not a multi-user hosted service.

Use [GitHub private vulnerability reporting](https://github.com/corgicorner/image-queue/security/advisories/new) to send a security report to the maintainers. Do not open a public issue for an unpatched vulnerability. Include the affected version, deployment mode, reproduction steps and expected versus actual behavior. Redact credentials, private images and personal paths.

If a provider key was exposed, revoke it at the provider and reconnect with a replacement. Never attach the exposed key to an issue.
