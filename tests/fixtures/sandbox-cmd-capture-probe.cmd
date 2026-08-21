@echo off
for /f "delims=" %%F in ('call "%DSH_TEST_NODE%" --version') do @echo %%F
