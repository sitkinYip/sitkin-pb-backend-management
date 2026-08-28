#!/bin/sh
# Run from the 1Panel HOST terminal. Passwords are read by the child shell,
# not interpolated into the host command, printed, or saved in shell history.
# The native PocketBase CLI necessarily receives the password as a short-lived
# process argument inside the container. Use only a trusted admin terminal/host.
set -eu

if [ ! -t 0 ] || [ ! -t 1 ]; then
  printf '%s\n' '请在交互式服务器终端运行，不要通过管道输入密码。' >&2
  exit 1
fi

questions_container=questions-game-v1
questions_version=$(docker exec "$questions_container" /pb/pocketbase --version)
if [ "$questions_version" != 'pocketbase version 0.40.1' ]; then
  printf '%s\n' '容器版本不匹配，未创建账号。' >&2
  exit 1
fi

docker exec -it "$questions_container" sh -c '
  set -eu
  set +x
  printf "PocketBase 管理员邮箱："
  IFS= read -r questions_email
  printf "新密码（16–71 字节，输入不显示）："
  questions_tty_state=$(stty -g)
  trap '\''stty "$questions_tty_state"; printf "\n"'\'' EXIT
  stty -echo
  IFS= read -r questions_password
  printf "\n再次输入密码："
  IFS= read -r questions_confirm
  stty "$questions_tty_state"
  trap - EXIT
  printf "\n"
  if [ "$questions_password" != "$questions_confirm" ] ||
     [ "${#questions_password}" -lt 16 ] ||
     [ "${#questions_password}" -gt 71 ]; then
    printf "%s\n" "两次密码不一致或长度不符合要求，未创建账号。" >&2
    exit 1
  fi
  unset questions_confirm
  /pb/pocketbase superuser create "$questions_email" "$questions_password" \
    --dir=/pb/pb_data \
    --hooksDir=/pb/pb_hooks \
    --migrationsDir=/pb/pb_migrations \
    --automigrate=false
  unset questions_password
'
