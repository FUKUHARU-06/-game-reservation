const { createClient } = require('@supabase/supabase-js');

// SupabaseのURLと公開APIキーを貼り付けてください
const supabaseUrl = 'https://wvcplyrnzjxhueakuptl.supabase.co'; // ← 控えたURLに置き換える
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Ind2Y3BseXJuemp4aHVlYWt1cHRsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTA2NjM0OTUsImV4cCI6MjA2NjIzOTQ5NX0.qJaqBBnM7fHKKHnI34Au-aH3o0rsF8aii-eOSAOk3C8';       // ← anon public key に置き換える

const supabase = createClient(supabaseUrl, supabaseKey);

module.exports = supabase;
