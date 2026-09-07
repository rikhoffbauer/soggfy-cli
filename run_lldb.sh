rm -f lldb_hack_out2.txt
touch lldb_hack_out2.txt
stdbuf -o0 xcrun lldb --batch -s lldb_hack2.txt > lldb_hack_out2.txt 2>&1 &
LLDB_PID=$!

echo "Waiting for LLDB to attach and resume..."
tail -f lldb_hack_out2.txt | while read LOGLINE
do
   echo "[LLDB] $LOGLINE"
   if [[ "$LOGLINE" == *"resuming"* ]] || [[ "$LOGLINE" == *"Process 76780 resuming"* ]]; then
      echo "LLDB IS RESUMING! Triggering stream..."
      curl -s -X POST http://localhost:8080/api/stream -H "Content-Type: application/json" -d '{"track":"https://open.spotify.com/track/5FFVCYuBDztqDMWDrqAJAo"}' &
      pkill -P $$ tail
   fi
done

wait $LLDB_PID
echo "LLDB Finished."
