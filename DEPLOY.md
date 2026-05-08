# How to Deploy Changes to Live

After Claude makes changes to your local files, follow these steps to push them live.

## 1. Open Your GitHub Repository

Go to https://github.com/peteravila/classroom-timer and sign in if needed.

## 2. Update Each Changed File

For each file Claude changed (Claude will tell you which ones):

1. Navigate to the file in GitHub (e.g., click `public` → `instructor.html`).
2. Click the **pencil icon** (Edit this file) in the upper right.
3. Select all the text in the editor (Ctrl+A) and delete it.
4. Open the local file on your computer (in `C:\Users\peter\Dropbox\Development\TimerApp`), select all (Ctrl+A), and copy (Ctrl+C).
5. Paste (Ctrl+V) into the GitHub editor.
6. Scroll down and click **Commit changes**.
7. In the popup, leave the defaults and click **Commit changes** again.

If the file doesn't exist on GitHub yet, click **Add file** → **Create new file**, then type the full path as the filename (e.g., `public/newfile.html` — the slash creates the folder automatically).

## 3. Deploy on Render

1. Go to https://dashboard.render.com and sign in.
2. Click on your **classroom-timer** service.
3. Click **Manual Deploy** → **Deploy latest commit**.
4. Wait about 1–2 minutes for the deploy to finish (the status will change to "Live").

## 4. Verify

Open your live URLs and confirm the changes:

- Instructor: https://classroom-timer.onrender.com/instructor
- Student: https://classroom-timer.onrender.com/student.html

Note: If the site has been idle, the first visit may take ~50 seconds to wake up.
