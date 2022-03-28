#!/bin/bash

# convoluted-looking but maximally POSIX-safe way of iterating through files
this_dir="$(dirname $0)"
install_scripts_list="$(ls -1 ${this_dir}/install_scripts/ 2>/dev/null)"
if [[ -z $install_scripts_list ]]; then
  echo No install scripts found in ./install_scripts
  exit 0
fi
install_script_count=$(echo -n "$install_scripts_list" | wc -l)
current_script_idx=0

# from now on, bail on any failed command
set -e

# turn off variable value expansion except for splitting at newlines
set -f; IFS='
'

for install_script in $install_scripts_list; do
  set +f; unset IFS
  current_script_idx="$(expr $current_script_idx + 1)"
  echo Running $current_script_idx of $install_script_count: install_scripts/$install_script
  sh ${this_dir}/install_scripts/${install_script}
done
set +f; unset IFS
