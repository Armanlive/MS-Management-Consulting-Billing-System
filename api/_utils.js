import {createClient} from '@supabase/supabase-js';
import {createHash,randomBytes} from 'node:crypto';
export const hash=s=>createHash('sha256').update(s).digest('hex');
export const code=()=>randomBytes(24).toString('base64url');
export function clients(){const url=process.env.SUPABASE_URL||process.env.VITE_SUPABASE_URL;const secret=process.env.SUPABASE_SERVICE_ROLE_KEY;const pub=process.env.VITE_SUPABASE_ANON_KEY;if(!url||!secret||!pub)throw Error('Server configuration missing');return {admin:createClient(url,secret,{auth:{persistSession:false,autoRefreshToken:false}}),publicClient:createClient(url,pub,{auth:{persistSession:false,autoRefreshToken:false}})};}
export const reply=(res,status,body)=>res.status(status).json(body);
