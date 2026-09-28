// npm run dist — electron-builder를 돌리되, 파일 잠김(EBUSY/EPERM)이면 잠시 기다렸다 다시 한다.
//
// 왜: electron-builder는 dist\win-unpacked에 WOLFPACK.exe를 막 풀어 놓자마자 아이콘·버전 정보를 쓰려고
// 다시 연다. 그 순간 Windows Defender 실시간 검사(또는 그 폴더를 연 탐색기의 아이콘 읽기)가 새 exe를 붙잡고
// 있으면 'EBUSY: resource busy or locked'로 실패한다. 타이밍 문제라 다시 하면 대개 된다.
// 그 밖의 실패는 그대로 멈춘다(재시도로 가리지 않는다).
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import path from 'node:path';

const require = createRequire(import.meta.url);
const cli = path.join(path.dirname(require.resolve('electron-builder/package.json')), 'cli.js');
const args = ['--win', '--x64', ...process.argv.slice(2)];
const TRIES = 3;
const LOCKED = /\b(EBUSY|EPERM)\b.*(resource busy or locked|operation not permitted)/i;

/** dist 안의 exe가 켜져 있으면 잠김이 확실하다 — 알려 주고 멈춘다(남의 프로세스를 대신 죽이지 않는다). */
function runningFromDist() {
  if (process.platform !== 'win32') return [];
  try {
    const dist = path.resolve('dist').toLowerCase();
    const out = execFileSync('powershell.exe', ['-NoProfile', '-Command',
      'Get-Process | Where-Object { $_.Path } | ForEach-Object { "$($_.Id)`t$($_.Path)" }'], { encoding: 'utf8' });
    return out.split(/\r?\n/).filter((l) => l.toLowerCase().includes(`\t${dist}\\`));
  } catch { return []; }
}

function build() {
  return new Promise((resolve) => {
    let log = '';
    const child = spawn(process.execPath, [cli, ...args], { stdio: ['inherit', 'pipe', 'pipe'] });
    child.stdout.on('data', (d) => { process.stdout.write(d); log += d; });
    child.stderr.on('data', (d) => { process.stderr.write(d); log += d; });
    child.on('close', (code) => resolve({ code, log }));
  });
}

const running = runningFromDist();
if (running.length) {
  console.error('[dist] dist 폴더의 실행 파일이 켜져 있어 덮어쓸 수 없습니다. 먼저 닫으세요:\n  ' + running.join('\n  '));
  process.exit(1);
}

for (let i = 1; i <= TRIES; i += 1) {
  const { code, log } = await build();
  if (code === 0) process.exit(0);
  if (!LOCKED.test(log) || i === TRIES) {
    if (LOCKED.test(log)) {
      console.error(`[dist] ${TRIES}번 모두 파일 잠김으로 실패했습니다. dist 폴더를 연 탐색기 창을 닫거나,`
        + ' Windows 보안에서 C:\\roadmap_board\\dist 를 실시간 검사 제외로 두면 사라집니다(관리자 권한).');
    }
    process.exit(code ?? 1);
  }
  const wait = 5 * i;
  console.error(`\n[dist] 파일 잠김(백신 검사·탐색기 등) — ${wait}초 뒤 다시 합니다 (${i + 1}/${TRIES})\n`);
  await new Promise((r) => setTimeout(r, wait * 1000));
}
