/*
  Damas españolas (simplified but faithful):
  - 8x8 tablero, piezas en casillas oscuras.
  - Fichas (peones) avanzan diagonalmente hacia adelante.
  - Coronación en la última fila.
  - Damas (reinas) vuelan: se mueven y capturan a distancia a lo largo de diagonales.
  - Captura obligatoria. Si hay múltiples secuencias de captura, se fuerza a la que captura más piezas.
  - Juego para 2 personas en el mismo dispositivo.
*/

const SIZE = 8;
const boardEl = document.getElementById('board');
const playerNameEl = document.getElementById('playerName');
const statusEl = document.getElementById('status');
const restartBtn = document.getElementById('restart');
const backBtn = document.getElementById('back');

let history = []; // stack of previous states for undo

// Timer (cronómetro)
const chronoEl = document.getElementById('chrono');
let chronoInterval = null;
let chronoStart = null;
let chronoElapsed = 0; // ms paused total

function formatTime(ms){
  const totalSec = Math.floor(ms/1000);
  const min = Math.floor(totalSec/60).toString().padStart(2,'0');
  const sec = (totalSec%60).toString().padStart(2,'0');
  return `${min}:${sec}`;
}

function startTimer(){
  if(chronoInterval) return;
  chronoStart = Date.now();
  chronoInterval = setInterval(()=>{
    const now = Date.now();
    const elapsed = chronoElapsed + (now - chronoStart);
    chronoEl.textContent = formatTime(elapsed);
  },250);
}

function stopTimer(){
  if(!chronoInterval) return;
  clearInterval(chronoInterval);
  chronoInterval = null;
  chronoElapsed += Date.now() - chronoStart;
  chronoStart = null;
  chronoEl.textContent = formatTime(chronoElapsed);
}

function resetTimer(){
  if(chronoInterval) { clearInterval(chronoInterval); chronoInterval = null; }
  chronoStart = null;
  chronoElapsed = 0;
  chronoEl.textContent = formatTime(0);
}

let state = {
  board: [], // 8x8 array of null or {color:'white'|'black', king:bool}
  turn: 'white',
  selected: null, // {r,c}
  legalMoves: [], // array of {to:{r,c}, captures: [{r,c}, ...], path: [{r,c}...]} path for visualization
  gameOver: false
};

function inBounds(r,c){ return r>=0 && r<SIZE && c>=0 && c<SIZE; }

function initBoard(){
  const b = Array.from({length:SIZE},()=>Array(SIZE).fill(null));
  for(let r=0;r<3;r++){
    for(let c=0;c<SIZE;c++){
      if((r+c)%2===1) b[r][c] = {color:'black', king:false};
    }
  }
  for(let r=5;r<8;r++){
    for(let c=0;c<SIZE;c++){
      if((r+c)%2===1) b[r][c] = {color:'white', king:false};
    }
  }
  state.board = b;
  state.turn = 'white';
  state.selected = null;
  state.legalMoves = [];
  state.gameOver = false;
  history = []; // clear undo history on new game
  resetTimer();
  updateUI();
  startTimer();
}

function cloneBoard(b){
  return b.map(row=>row.map(cell=>cell?{...cell}:null));
}

// generate all legal moves for a player; prioritize captures and choose maximal capture sequences
function allLegalMovesFor(color){
  const movers = [];
  const board = state.board;
  for(let r=0;r<SIZE;r++) for(let c=0;c<SIZE;c++){
    const piece = board[r][c];
    if(piece && piece.color===color){
      const seqs = generateMovesFor(r,c,piece,true);
      if(seqs.length) movers.push(...seqs.map(s=>({from:{r,c}, ...s})));
    }
  }
  if(!movers.length) return [];
  const maxCap = Math.max(...movers.map(m=>m.captures.length));
  if(maxCap>0) return movers.filter(m=>m.captures.length===maxCap);
  return movers;
}

// generate move sequences for a piece at r,c
// returns array of {to:{r,c}, captures:[{r,c},...], path:[{r,c}...]}
function generateMovesFor(r,c,piece,fullSearch){
  if(piece.king) return generateKingMoves(r,c,piece);
  else return generateManMoves(r,c,piece,fullSearch);
}

function generateManMoves(r,c,piece,fullSearch){
  const dirs = piece.color==='white' ? [[-1,-1],[-1,1]] : [[1,-1],[1,1]];
  const captures = [];
  // search for capture sequences (multi-jump)
  function dfs(br,bc,board,seen,caps,path){
    let found = false;
    // men may only capture forward (same directions as simple moves)
    for(const [dr,dc] of dirs){
      const ar = br+dr, ac = bc+dc;
      const jr = br+2*dr, jc = bc+2*dc;
      if(!inBounds(ar,ac) || !inBounds(jr,jc)) continue;
      const mid = board[ar][ac], landing = board[jr][jc];
      if(mid && mid.color!==piece.color && !landing && !seen.has(ar+','+ac)){
        // simulate jump
        const nb = cloneBoard(board);
        nb[br][bc]=null; nb[ar][ac]=null; nb[jr][jc]={...piece};
        const nseen = new Set(seen); nseen.add(ar+','+ac);
        const npath = path.concat([[jr,jc]]);
        const ncaps = caps.concat([[ar,ac]]);
        const deeper = dfs(jr,jc,nb,nseen,ncaps,npath);
        found = found || deeper;
      }
    }
    if(!found){
      if(caps.length) captures.push({to:{r:br,c:bc}, captures:caps.slice(), path:path.slice()});
      return false;
    }
    return true;
  }
  dfs(r,c,state.board,new Set(),[],[{r,c}]);
  if(captures.length){
    // return captures sequences (man must also look for longest)
    const maxCap = Math.max(...captures.map(s=>s.captures.length));
    return captures.filter(s=>s.captures.length===maxCap);
  }
  if(!fullSearch){
    // when not searching full (shouldn't happen) skip simple moves
    return [];
  }
  // simple moves (no captures)
  const moves = [];
  for(const [dr,dc] of dirs){
    const nr=r+dr, nc=c+dc;
    if(inBounds(nr,nc) && !state.board[nr][nc]) moves.push({to:{r:nr,c:nc},captures:[],path:[{r,c},{r:nr,c:nc}]});
  }
  return moves;
}

function generateKingMoves(r,c,piece){
  const captures = [];
  const board = state.board;
  // For kings we must consider flying captures with potentially multiple captures
  function dfs(br,bc,board,seen,caps,path){
    let found = false;
    for(const [dr,dc] of [[-1,-1],[-1,1],[1,-1],[1,1]]){
      let i=1;
      while(true){
        const ar = br+dr*i, ac = bc+dc*i;
        if(!inBounds(ar,ac)) break;
        if(board[ar][ac]==null) { i++; continue; }
        if(board[ar][ac].color===piece.color) break;
        // found enemy at (ar,ac); must find landing squares beyond
        let j=1;
        while(true){
          const lr = ar+dr*j, lc = ac+dc*j;
          if(!inBounds(lr,lc)) break;
          if(board[lr][lc]) break; // blocked
          if(seen.has(ar+','+ac)) { j++; continue; } // can't capture same twice
          // simulate capture landing at lr,lc
          const nb = cloneBoard(board);
          nb[br][bc]=null; nb[ar][ac]=null; nb[lr][lc]={...piece, king:true};
          const nseen = new Set(seen); nseen.add(ar+','+ac);
          const npath = path.concat([[lr,lc]]);
          const ncaps = caps.concat([[ar,ac]]);
          const deeper = dfs(lr,lc,nb,nseen,ncaps,npath);
          found = found || deeper;
          j++;
        }
        break; // can only capture first enemy encountered in this direction
      }
    }
    if(!found){
      if(caps.length) captures.push({to:{r:br,c:bc},captures:caps.slice(),path:path.slice()});
      return false;
    }
    return true;
  }
  dfs(r,c,board,new Set(),[],[{r,c}]);
  if(captures.length){
    const maxCap = Math.max(...captures.map(s=>s.captures.length));
    return captures.filter(s=>s.captures.length===maxCap);
  }
  // non-capturing sliding moves
  const moves = [];
  for(const [dr,dc] of [[-1,-1],[-1,1],[1,-1],[1,1]]){
    let i=1;
    while(true){
      const nr=r+dr*i, nc=c+dc*i;
      if(!inBounds(nr,nc) || state.board[nr][nc]) break;
      moves.push({to:{r:nr,c:nc},captures:[],path:[{r,c},{r:nr,c:nc}]});
      i++;
    }
  }
  return moves;
}

function updateUI(){
  boardEl.innerHTML = '';
  boardEl.style.pointerEvents = state.gameOver ? 'none' : 'auto';
  for(let r=0;r<SIZE;r++){
    for(let c=0;c<SIZE;c++){
      const cell = document.createElement('div');
      cell.className = 'cell ' + ((r+c)%2===0? 'light':'dark');
      cell.dataset.r = r; cell.dataset.c = c;
      cell.setAttribute('role','gridcell');
      const piece = state.board[r][c];
      if(piece){
        const p = document.createElement('div');
        p.className = 'piece ' + (piece.color==='white'?'white':'black') + (piece.king?' king':'');
        if(state.selected && state.selected.r==r && state.selected.c==c) p.classList.add('selected');
        cell.appendChild(p);
      } else {
        // empty; maybe mark moves
        const moveSpot = state.legalMoves.find(m=>m.to.r==r && m.to.c==c);
        if(moveSpot){
          const dot = document.createElement('div');
          dot.className = moveSpot.captures.length ? 'capture-dot' : 'move-dot';
          cell.appendChild(dot);
        }
      }
      // highlight if selectable
      if(state.selected && state.selected.r==r && state.selected.c==c){
        cell.classList.add('highlight');
      }
      boardEl.appendChild(cell);
    }
  }
  playerNameEl.textContent = state.turn==='white' ? 'Blancas' : 'Negras';
  statusEl.textContent = state.gameOver ? (state.turn==='white' ? 'Negras han ganado' : 'Blancas han ganado') : '';
  // stop timer when game ends
  if(state.gameOver) stopTimer();
}

function setStatus(msg){ statusEl.textContent = msg; }

boardEl.addEventListener('click', (ev)=>{
  if(state.gameOver) return;
  const cell = ev.target.closest('.cell');
  if(!cell) return;
  const r = +cell.dataset.r, c = +cell.dataset.c;
  const clicked = state.board[r][c];
  // if clicking own piece: select if it has legal moves
  if(clicked && clicked.color===state.turn){
    const allMoves = allLegalMovesFor(state.turn);
    const hasMovesFrom = allMoves.some(m=>m.from.r==r && m.from.c==c);
    if(hasMovesFrom){
      state.selected = {r,c};
      state.legalMoves = allMoves.filter(m=>m.from.r==r && m.from.c==c);
      updateUI(); return;
    } else {
      // cannot select piece with no legal moves - deselect
      state.selected = null; state.legalMoves = [];
      updateUI(); return;
    }
  }
  // clicking empty square: if a legal move exists to there, perform it
  if(state.selected){
    const move = state.legalMoves.find(m=>m.to.r==r && m.to.c==c);
    if(move){
      applyMove(move);
    } else {
      // clicked elsewhere: clear selection
      state.selected = null; state.legalMoves = [];
      updateUI();
    }
  }
});

function applyMove(move){
  // push a snapshot for undo
  history.push({
    board: cloneBoard(state.board),
    turn: state.turn,
    selected: state.selected ? {...state.selected} : null
  });

  const {from,to,captures} = move;
  const b = state.board;
  const piece = b[from.r][from.c];
  b[from.r][from.c]=null;
  b[to.r][to.c]=piece;
  // remove captured pieces
  for(const [cr,cc] of captures) b[cr][cc]=null;
  // coronación
  if(!piece.king){
    if(piece.color==='white' && to.r===0) piece.king=true;
    if(piece.color==='black' && to.r===SIZE-1) piece.king=true;
  }
  // After a capture, check if same piece can continue capturing (multi jump)
  if(captures.length>0){
    state.board = b; // update before checking
    const further = generateMovesFor(to.r,to.c,piece,true).filter(s=>s.captures.length>0);
    if(further.length>0){
      const allMovesAfter = allLegalMovesFor(state.turn);
      const contFromThis = allMovesAfter.filter(m=>m.from.r===to.r && m.from.c===to.c && m.captures.length>0);
      if(contFromThis.length>0){
        state.selected = {r:to.r,c:to.c};
        state.legalMoves = contFromThis;
        updateUI();
        return;
      }
    }
  }
  // switch turn
  state.turn = state.turn==='white' ? 'black' : 'white';
  state.selected = null;
  state.legalMoves = [];
  const nextMoves = allLegalMovesFor(state.turn);
  if(nextMoves.length === 0){
    state.gameOver = true;
    updateUI();
    return;
  }
  updateUI();
}

restartBtn.addEventListener('click', initBoard);

if(backBtn){
  backBtn.addEventListener('click', ()=>{
    if(history.length===0) return;
    const prev = history.pop();
    state.board = prev.board;
    state.turn = prev.turn;
    state.selected = prev.selected;
    state.legalMoves = [];
    state.gameOver = false;
    updateUI();
  });
}

// initial
initBoard();
