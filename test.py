import time
import sys
print("Hello from Python!")
for i in range(3):
    print(f"Streaming output {i+1}/3...")
    sys.stdout.flush()
    time.sleep(0.5)
print("Python execution complete.")
