from __future__ import annotations

import argparse
import sys
import time

from .policy import ControllerError, REQUEST_SUBSCRIPTION, RESPONSE_TOPIC, encode_pubsub_message
from .pubsub_rest import RestPubSub
from .relay import process_message


def run_once(client: RestPubSub, queue_issue: int) -> bool:
    message = client.pull(REQUEST_SUBSCRIPTION)
    if message is None:
        return False
    response = process_message(message.data, queue_issue)
    client.publish(RESPONSE_TOPIC, encode_pubsub_message(response, 65_536), response["requestId"])
    client.ack(REQUEST_SUBSCRIPTION, message.ack_id)
    return True


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--queue-issue", type=int, required=True)
    args = parser.parse_args()
    client = RestPubSub()
    ready = False
    while True:
        try:
            if not ready:
                client.verify_transport()
                print("controller_ready=1", flush=True)
                ready = True
            handled = run_once(client, args.queue_issue)
            if not handled:
                time.sleep(5)
        except ControllerError as exc:
            print(f"controller_error={exc}", file=sys.stderr, flush=True)
            time.sleep(5)


if __name__ == "__main__":
    main()
