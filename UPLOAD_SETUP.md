# Image Upload Setup for VPS

## Problem
The uploads directory might not exist on the VPS, causing "ENOENT: no such file or directory" errors when uploading images.

## Solution Applied

### 1. Automatic Directory Creation
The backend now automatically creates the `uploads` directory on startup if it doesn't exist.

### 2. Absolute Path Usage
Changed from relative path `./uploads/` to absolute path to ensure it works correctly on VPS.

### 3. Error Handling
Added proper error handling and validation for file uploads.

## Manual Setup (if needed)

If you need to manually create the directory on VPS:

```bash
# SSH into your VPS
ssh user@82.165.217.122

# Navigate to backend directory
cd /path/to/backend

# Create uploads directory
mkdir -p uploads

# Set proper permissions
chmod 755 uploads

# Or run the setup script
node ensure-uploads-dir.js
```

## Verify Uploads Directory

After deployment, verify the directory exists:

```bash
# Check if directory exists
ls -la backend/uploads

# Check permissions
stat backend/uploads
```

## Testing

1. Upload an image through the frontend
2. Check backend logs for: "File uploaded successfully"
3. Verify file exists: `ls backend/uploads/`
4. Access file via: `http://82.165.217.122:5052/files/filename.jpg`

## Troubleshooting

### Error: "ENOENT: no such file or directory"
- **Solution**: The directory will be created automatically on server restart
- **Manual fix**: Run `mkdir -p backend/uploads` on VPS

### Error: "Permission denied"
- **Solution**: Set proper permissions: `chmod 755 backend/uploads`

### Files not accessible via /files route
- **Check**: Ensure `app.use('/files', express.static(uploadsPath))` is configured
- **Verify**: File path in response matches `/files/filename`

## File Upload Configuration

- **Max file size**: 10MB
- **Allowed types**: JPEG, JPG, PNG, GIF, WebP
- **Storage location**: `backend/uploads/`
- **Access URL**: `http://82.165.217.122:5052/files/filename`
