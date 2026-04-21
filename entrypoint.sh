#!/bin/sh
MEMORY_BACKEND="${MEMORY_BACKEND:-lance}"
exec pi --no-skills --no-prompt-templates -e "/ext/${MEMORY_BACKEND}-extension.ts" "$@"
