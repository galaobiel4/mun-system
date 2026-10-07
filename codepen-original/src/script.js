const pais = document.getElementById("pais")
const votacao = document.getElementById("votacao")
function selecao(aba){
  console.log(aba)
const listapaises = [
  "Brasil",
  "Rússia",
  "EUA",
  "Índia",
  "China",
  "Nigéria",
  "Alemanha",
  "França",
  "Turquia",
  "Reino Unido",
  
]
if (aba === "UNICEF"){
  console.log("10 paises")
  pais.innerHTML= ""
  votacao.innerHTML = ""
   for(let i = 0;i< listapaises.length; i++){
   //HTML dos expansíveis de 
     pais.innerHTML+=
      `<details>
    <summary><b>${listapaises[i]}</b></summary>
    <label class=labelComentarios><b>Comentários:</b></label><br>
    <textarea class='comentarios' placeholder='Insira comentários sobre a delegação...'></textarea>
  </details>`
     votacao.innerHTML+= `<span class=votopais>${listapaises[i]}</span>
      <input type=radio name="${listapaises[i]}voto" value="favoravel" id="voto${i}Fav"> <label id="voto1">Favorável</label>
      <input type=radio name="${listapaises[i]}voto" value="abstido" id="voto${i}Abs"> <label>Abstido</label>
      <input type=radio name="${listapaises[i]}voto" value="contra" id=voto${i}Contra> <label>Contra</label>
     <br> `
   
   }
}
  else{
     pais.innerHTML= ""
    votacao.innerHTML = ""
  for(let i=0;i<9;i++){
    pais.innerHTML+=
      `<details>
    <summary><b>${listapaises[i]}</b></summary>
    <label class=labelComentarios><b>Comentários:</b></label><br>
    <textarea class='comentarios' placeholder='Insira comentários sobre a delegação...'></textarea>
  </details>`
    votacao.innerHTML+= `<span class=votopais>${listapaises[i]}</span>
      <input type=radio name="${listapaises[i]}voto" value="favoravel" id="voto${i}Fav"> <label id="voto1">Favorável</label>
      <input type=radio name="${listapaises[i]}voto" value="abstido" id="voto${i}Abs"> <label>Abstido</label>
      <input type=radio name="${listapaises[i]}voto" value="contra" id=voto${i}Contra> <label>Contra</label>
     <br> `
  
  }
  }  
  const comites = {
    CSNU: {
      veto: true,
      paisesVeto:[
        "EUA",
        "RUSSIA",
        "CHINA",
        "FRANCA",
        "REINO UNIDO"
      ],
      maioria:"3/5"
    },
    CDH: {
      veto: false,
      paisesVeto: [],
      maioria:"simples"
    },
      OMS: {
        veto: false,
        paiseVeto:[],
        maioria:"2/3"
      },
    UNESCO: {
      veto: false,
      paisesVeto:[],
      maioria:"2/3"
    },
    ONUM: {
      veto: false,
      paisesVeto: [],
      maioria:"simples"
    },
    UNICEF: {
      veto: false,
      paisesVeto: [],
      maioria:"simples"
    },
    CDESC: {
      veto: false,
      paisesVeto: [],
      maioria:"simples"
    },
    ACNUR: {
    veto: false,
    paisesVeto:[],
    maioria:"simples"
   }
    }
  let config = comites[aba];
    console.log(config)
  
  
  } 

