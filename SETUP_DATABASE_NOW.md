# 🚀 Get Your Database Running in 2 Minutes

## Step 1: Get Your Free Database (1 minute)

1. **Open** https://neon.tech/ in your browser
2. **Click** "Start Free" (top right)
3. **Sign in** with GitHub or Google (instant)
4. **Your database is created automatically!**

## Step 2: Copy Your Connection String (30 seconds)

1. On the Neon dashboard, you'll see a box with your connection string
2. It looks like this:
   ```
   postgresql://username:password@ep-something.region.aws.neon.tech/neondb?sslmode=require
   ```
3. **Click the copy button** next to it

## Step 3: Add to Your App (30 seconds)

1. Open the `.env` file in this project
2. Replace the placeholder DATABASE_URL with your copied string:
   ```env
   DATABASE_URL=postgresql://your-actual-connection-string-here
   PORT=5000
   NODE_ENV=development
   ```
3. Save the file

## Step 4: Run Your App! 🎉

```bash
# Initialize the database tables
npm run db:push

# Start the application
npm run dev
```

## That's it! Your app is now running with a real database!

Visit http://localhost:5000 and you'll see:
- ✅ Patient management system
- ✅ DICOM file upload
- ✅ Medical image viewer
- ✅ All data persists in your database

## Troubleshooting

If you see "password authentication failed":
- Make sure you copied the ENTIRE connection string from Neon
- Check there are no extra spaces or line breaks
- The connection string should be on ONE line

Need help? The connection string in Neon looks like this:
![Neon Dashboard](https://neon.tech/docs/get-started-with-neon/images/neon-dashboard.png)