const fs = require('fs');
const path = require('path');

const file = path.join(
  __dirname,
  '..',
  'node_modules',
  'expo-modules-core',
  'android',
  'src',
  'main',
  'java',
  'expo',
  'modules',
  'adapters',
  'react',
  'permissions',
  'PermissionsService.kt'
);

if (!fs.existsSync(file)) {
  console.log('[patch-expo-sdk36] PermissionsService.kt not found, skipping.');
  process.exit(0);
}

let content = fs.readFileSync(file, 'utf8');

const regex = /override fun isPermissionPresentInManifest\(permission: String\): Boolean \{[\s\S]*?catch \(e: PackageManager\.NameNotFoundException\)/;

const replacement = `override fun isPermissionPresentInManifest(permission: String): Boolean {
    try {
      val packageInfo = context.packageManager.getPackageInfo(context.packageName, PackageManager.GET_PERMISSIONS)
      return packageInfo?.requestedPermissions?.contains(permission) == true
    } catch (e: PackageManager.NameNotFoundException)`;

if (regex.test(content)) {
  content = content.replace(regex, replacement);
  fs.writeFileSync(file, content, 'utf8');
  console.log('[patch-expo-sdk36] Successfully patched PermissionsService.kt for SDK 36 nullability.');
} else {
  console.log('[patch-expo-sdk36] Already patched or target pattern not found.');
}
