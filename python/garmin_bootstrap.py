"""One-time interactive Garmin Connect login that mints a reusable token store.

Usage:  python garmin_bootstrap.py <tokenstore_dir>

Why this exists: Garmin's SSO sits behind a Cloudflare WAF that rate-limits the
mobile login endpoint, and most accounts have MFA enabled, so a service cannot
log in headlessly with a stored password. `garminconnect`'s widget+cffi login
strategy (HTML web-widget SSO plus curl_cffi TLS impersonation) gets through and
supports MFA — but it needs a human at the keyboard, once.

Your email, password and MFA code are read straight from this prompt. They are
never written to disk, never passed as command-line arguments (which would show
up in the process list), and never logged. Only the resulting tokens are saved.

Afterwards the service loads those tokens and refreshes them on its own. Re-run
this only if uploads start failing with an auth error.
"""

import getpass
import sys


def main():
    if len(sys.argv) < 2:
        print("usage: garmin_bootstrap.py <tokenstore_dir>", file=sys.stderr)
        sys.exit(2)

    tokenstore = sys.argv[1]

    try:
        from garminconnect import Garmin
    except ImportError:
        print(
            "The 'garminconnect' package is not installed.\n"
            "  pip install -r python/requirements.txt\n"
            "See docs/garmin-access.md for the Docker alternative.",
            file=sys.stderr,
        )
        sys.exit(2)

    email = input("Garmin Connect email: ").strip()
    password = getpass.getpass("Garmin Connect password (hidden): ")

    try:
        client = Garmin(
            email=email,
            password=password,
            prompt_mfa=lambda: input("MFA / 2FA code: ").strip(),
        )
        client.login(tokenstore=tokenstore)
    except Exception as e:  # noqa: BLE001
        msg = str(e)
        print(f"\nLogin failed: {msg}", file=sys.stderr)
        if "429" in msg or "too many" in msg.lower():
            print(
                "\nGarmin is rate-limiting you (HTTP 429). Wait at least an hour and try\n"
                "again — retrying in a loop makes it worse. See docs/garmin-access.md.",
                file=sys.stderr,
            )
        sys.exit(3)

    print(f"\nSuccess. Tokens saved to {tokenstore}")
    print("Treat that directory like a password: chmod 700, and never commit it.")


if __name__ == "__main__":
    main()
