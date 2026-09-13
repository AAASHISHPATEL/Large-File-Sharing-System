@echo off
set MINIO_ROOT_USER=minioadmin
set MINIO_ROOT_PASSWORD=minioadminpassword
"%USERPROFILE%\Downloads\minio.exe" server "%USERPROFILE%\minio-data" --console-address ":9001"
