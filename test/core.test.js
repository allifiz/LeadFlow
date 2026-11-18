import test from 'node:test';
import assert from 'node:assert/strict';
import {phoneNumber,mobileNumber,normalizeLead,draft,eligible,templatePayload} from '../lib/core.js';
test('normalisasi tanpa menyebut nomor landline sebagai WA',()=>{assert.equal(phoneNumber('0812-3456-7890'),'6281234567890');assert.equal(phoneNumber('0262-233803'),'62262233803');assert.equal(mobileNumber('62262233803'),false);assert.equal(phoneNumber('bad'),null);});
test('import tidak mengizinkan status/consent dari data eksternal',()=>{const x=normalizeLead({name:'Contoh',phone:'081234567890',opt_in_at:'today',status:'submitted',priority:120});assert.equal(x.priority,100);assert.equal(x.opt_in_at,undefined);assert.equal(x.status,undefined);});
test('kontak minimal satu wajib',()=>{assert.throws(()=>normalizeLead({name:'X'}));assert.throws(()=>normalizeLead({name:'X',email:'x'}));});
test('consent eksplisit, nomor WA dan status baru diwajibkan',()=>{const x={status:'new',phone:'6281234567890',wa_verified:1,opt_in_at:'today',opt_in_evidence:'consent recorded'};assert.equal(eligible(x),true);assert.equal(!!eligible({...x,opt_in_evidence:''}),false);assert.equal(!!eligible({...x,blocked_at:'today'}),false);assert.equal(eligible({...x,status:'submitted'}),false);});
test('template payload dan draft',()=>{const l={name:'Contoh',category:'sekolah',phone:'6281234567890'};assert.match(draft(l,'2026-11-19'),/Contoh/);assert.match(draft(l),/pendaftaran siswa/);assert.equal(templatePayload(l,'intro','id').template.components[0].parameters[0].text,'Contoh');});
