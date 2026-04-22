#!/bin/bash
# Downloads high-res images for posts by extracting fresh URLs from the browser.
# Usage: pipe post IDs, one per line. Each URL is fetched from the server after
# the extension backfill sends them.
#
# This script reads URLs from the DB that were freshly scraped by the extension,
# downloads them via curl, and updates image_local_paths.

DB="/Users/nate/code/linkedin/data/linkedin.db"
IMAGES_DIR="/Users/nate/code/linkedin/data/images"

success=0
fail=0

while IFS= read -r post_id; do
  urls=$(sqlite3 "$DB" "SELECT image_urls FROM posts WHERE id = '$post_id'")
  if [ -z "$urls" ] || [ "$urls" = "[]" ]; then
    echo "SKIP $post_id — no URLs in DB"
    ((fail++))
    continue
  fi

  mkdir -p "$IMAGES_DIR/$post_id"

  # Parse JSON array and download each URL
  count=$(echo "$urls" | python3 -c "import sys,json; print(len(json.load(sys.stdin)))" 2>/dev/null)
  if [ -z "$count" ] || [ "$count" = "0" ]; then
    echo "SKIP $post_id — can't parse URLs"
    ((fail++))
    continue
  fi

  all_ok=true
  paths="["
  for i in $(seq 0 $((count-1))); do
    url=$(echo "$urls" | python3 -c "import sys,json; print(json.load(sys.stdin)[$i])")
    outfile="$IMAGES_DIR/$post_id/$i.jpg"

    curl -s -o "$outfile" "$url"
    filetype=$(file -b "$outfile" 2>/dev/null)

    if echo "$filetype" | grep -q "JPEG\|PNG\|image"; then
      w=$(sips -g pixelWidth "$outfile" 2>/dev/null | grep pixelWidth | awk '{print $2}')
      [ "$i" -gt 0 ] && paths="$paths,"
      paths="$paths\"$post_id/$i.jpg\""
      printf "  OK %s/%d.jpg (%spx)\n" "$post_id" "$i" "$w"
    else
      all_ok=false
      printf "  FAIL %s/%d.jpg (got %s)\n" "$post_id" "$i" "$filetype"
      rm -f "$outfile"
    fi
  done
  paths="$paths]"

  if [ "$paths" != "[]" ]; then
    sqlite3 "$DB" "UPDATE posts SET image_local_paths = '$paths' WHERE id = '$post_id';"
    ((success++))
  else
    ((fail++))
  fi
done

echo ""
echo "Done: $success downloaded, $fail failed"
