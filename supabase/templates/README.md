# Supabase Email Templates for Split Your Trip

These HTML templates are formatted with brand styling and configured to supply the **6-digit verification code (`{{ .Token }}`)** so users can enter the code directly into the **Split Your Trip** mobile application.

---

## 1. Reset Password (Forgot Password) Template

### Where to configure in Supabase Dashboard:
1. Open your [Supabase Dashboard](https://supabase.com/dashboard/project/hpjizujbzvwkxvfsoqqd).
2. Go to **Authentication** in the left sidebar.
3. Click on **Email Templates** under the *Configuration* section.
4. Select the **Reset Password** tab.

### Settings to apply:
- **Subject**: 
  ```text
  Reset your Split Your Trip password - {{ .Token }}
  ```
- **Body**: 
  Copy and paste the complete content of:
  [`supabase/templates/reset_password.html`](./reset_password.html)
5. Click **Save Changes**.

---

## 2. Confirm Signup (Email Verification) Template

### Where to configure in Supabase Dashboard:
1. In the same **Email Templates** section, select the **Confirm signup** tab.

### Settings to apply:
- **Subject**: 
  ```text
  Confirm your Split Your Trip account - {{ .Token }}
  ```
- **Body**: 
  Copy and paste the complete content of:
  [`supabase/templates/confirm_signup.html`](./confirm_signup.html)
2. Click **Save Changes**.

---

## 3. Important Supabase Auth Configuration

To ensure smooth OTP delivery and compatibility with the mobile app:
1. In Supabase Dashboard, navigate to **Authentication** -> **URL Configuration** / **Auth Settings**.
2. **OTP Expiry**: Set the OTP expiration time (e.g. `3600` seconds / 1 hour).
3. **Site URL / Redirect URLs**:
   - Ensure your mobile app deep link scheme is included:
     - `splityourtrip://*`
     - `com.splityourtrip.app://*`

---

## How It Works in Split Your Trip
1. When a user requests a password reset from the login screen, `supabase.auth.resetPasswordForEmail(email)` is called.
2. Supabase emails the user using the template above, showing the 6-digit code from `{{ .Token }}`.
3. The user enters the 6 digits and their new password into the app modal.
4. The app verifies the OTP via:
   ```ts
   await supabase.auth.verifyOtp({
     email: userEmail,
     token: enteredOtp,
     type: 'recovery',
   });
   await supabase.auth.updateUser({
     password: newPassword,
   });
   ```
5. Session is established and the user is logged into the app immediately.
