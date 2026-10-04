const { createClient } = require('@supabase/supabase-js');
const url = 'https://hpjizujbzvwkxvfsoqqd.supabase.co';
const key = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imhwaml6dWpienZ3a3h2ZnNvcXFkIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzg0Mjc2NzksImV4cCI6MjA5NDAwMzY3OX0.9sbvx4gqUiDc4Kz41KMXylUiQsLTSST2bPhIxfUqdgE';
const sb = createClient(url, key);

let lastCount = -1;

async function poll() {
  try {
    const { data: trips, error } = await sb.from('trips').select('id, name, created_by, created_at').order('created_at', { ascending: false });
    if (error) {
      console.log('Query error:', error.message);
      return;
    }
    const count = trips ? trips.length : 0;
    const time = new Date().toLocaleTimeString();

    if (count !== lastCount) {
      console.log(`\n[${time}] 🔄 Trips in Supabase Cloud updated! Total: ${count}`);
      if (count === 0) {
        console.log('   (No trips in database yet. Waiting for a trip to be created from your phone...)');
      } else {
        trips.forEach((t, i) => {
          console.log(`   ${i + 1}. "${t.name}" (ID: ${t.id}, Created By: ${t.created_by}, Time: ${t.created_at})`);
        });
      }
      lastCount = count;
    } else {
      process.stdout.write(`\r[${time}] Listening for trips... Total in Cloud: ${count} `);
    }
  } catch (e) {
    console.log('Error polling:', e.message);
  }
}

console.log('====================================================');
console.log('  📡 SplitYourTrip Real-Time Supabase Cloud Monitor');
console.log('  Connected to: https://hpjizujbzvwkxvfsoqqd.supabase.co');
console.log('====================================================\n');

poll();
setInterval(poll, 3000);
