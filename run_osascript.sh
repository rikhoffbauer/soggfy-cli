rm -f lldb_osa.txt
touch lldb_osa.txt
xcrun lldb --batch -s lldb_osascript.txt > lldb_osa.txt 2>&1 &
LLDB_PID=$!

echo "Waiting for LLDB to resume..."
while true; do
    if grep -q "resuming" lldb_osa.txt; then
        echo "Resumed! Sending AppleScript..."
        osascript -e 'tell application "Spotify" to play track "spotify:track:5FFVCYuBDztqDMWDrqAJAo"'
        break
    fi
    sleep 0.2
done

wait $LLDB_PID
echo "Done!"
