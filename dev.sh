#!/bin/bash

chmod +x backend/*.sh
chmod +x frontend/*.sh

dev() {
  case "$1" in
    "setup")
      ./backend/setup.sh
      ./frontend/setup.sh
      ;;
    "run")
      if [ $# -eq 1 ]; then
        ./backend/start.sh &
        PID_BE=$!
        ./frontend/start.sh &
        PID_FE=$!

        trap "kill $PID_BE $PID_FE" EXIT
        wait $PID_BE $PID_FE
      else
        case "$2" in
          "backend")
            ./backend/start.sh
            ;;
          "frontend")
            ./frontend/start.sh
            ;;
          *)
            echo "Usage: dev run [backend|frontend]"
            ;;
        esac
      fi
      ;;
    *)
      echo "Usage: dev run"
      ;;
  esac
}

