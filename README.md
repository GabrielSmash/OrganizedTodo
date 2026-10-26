# OrganizedTodo

> A todo list for the GNOME top bar, organized as **projects → lists → tasks**, with automatic project completion. (Interface in Portuguese, pt-BR.)

Uma lista de tarefas que fica na barra superior do GNOME, organizada em **projetos → listas → tarefas**. Quando todas as tarefas de um projeto são concluídas, o projeto é marcado como concluído automaticamente.

Derivado do [Todoit](https://github.com/wassimbj/todoit-gnome), de wassimbj (MIT). O modelo de dados, as telas e a maior parte do código foram reescritos. Veja a seção [Licença e créditos](#licença-e-créditos).

## Recursos

- **Três telas com botão de voltar:** Projetos → Listas → Tarefas.
- **Conclusão automática:** ao marcar a última tarefa pendente de um projeto (somando todas as listas dele), o projeto vira "concluído" e você volta para a tela de projetos.
- **Concluídos:** ficam guardados, acessíveis e podem ser reativados.
- **Edição no próprio lugar:** renomeie projetos, listas e tarefas sem abrir outra tela.
- **Foco e ordem:** destaque uma tarefa (ela fixa no topo da lista) e arraste para reordenar.
- **Só um ícone no painel**, aberto por clique ou pelo atalho `Alt+Shift+Espaço`.

## Requisitos

- GNOME Shell **45 a 50**. Testado apenas no **50**; nas outras versões pode haver diferenças.
- Para instalar a partir do código-fonte: `git`, `make` e `glib-compile-schemas`
  (Ubuntu/Debian: pacote `libglib2.0-bin`; Fedora: `glib2-devel`).
- Para compilar o daemon (o backend em Rust): **Rust 1.92 ou mais novo** (`cargo`, via [rustup](https://rustup.rs)),
  `pkg-config` e os headers da GLib (Ubuntu/Debian: `pkg-config libglib2.0-dev`; Fedora: `pkgconf glib2-devel`).
- Para gerar o zip (`make pack`): `zip`.

## Instalação

### A partir do código-fonte (recomendado)

```sh
git clone https://github.com/GabrielSmash/OrganizedTodo.git
cd OrganizedTodo
make install
```

O `make install` faz duas coisas:

1. Compila o schema e copia a extensão para
   `~/.local/share/gnome-shell/extensions/organizedtodo@gabrielsmash.github.io/`.
2. Compila o **daemon** e o instala (`make install-daemon`):
   - o binário em `~/.local/bin/organizedtodo-daemon`;
   - o arquivo de ativação em `~/.local/share/dbus-1/services/io.github.gabrielsmash.OrganizedTodo.service`.

Você não precisa iniciar o daemon: o D-Bus o inicia sozinho na primeira vez que a extensão o chama.

Se o repositório já estiver dentro da pasta de extensões (clonado direto em
`~/.local/share/gnome-shell/extensions/organizedtodo@gabrielsmash.github.io`), rode só `make install-daemon`.

### A partir de um zip

Se alguém lhe enviou o arquivo `organizedtodo@gabrielsmash.github.io.shell-extension.zip`:

```sh
gnome-extensions install --force organizedtodo@gabrielsmash.github.io.shell-extension.zip
```

Para gerar esse zip a partir do código: `make pack`.

O zip contém **só a extensão**. O daemon precisa ser instalado a partir do código-fonte (`make install-daemon`);
sem ele, o menu abre vazio e o erro aparece no log (`journalctl --user -g organizedtodo`).

### Ativar

No **Wayland** o GNOME só enxerga extensões novas depois de uma nova sessão:

1. Saia da sessão e entre de novo (no X11 dá para recarregar com `Alt+F2`, `r`, Enter).
2. Ative a extensão:

```sh
gnome-extensions enable organizedtodo@gabrielsmash.github.io
```

Se estiver com o **Todoit original** ativo, desative-o: os dois respondem a `Alt+Shift+Espaço`. Os dados são separados, e o OrganizedTodo **não** lê a lista do Todoit.

### Atualizar

Dentro da pasta do repositório: `git pull && make install`, e depois saia e entre na sessão (o GNOME guarda o código das extensões em cache).

Se o daemon já estiver rodando, ele continua com a versão antiga até ser encerrado. Sair da sessão já resolve;
para trocar na hora: `pkill -x organizedtodo-d` (o D-Bus inicia a versão nova na próxima chamada).

### Desinstalar

```sh
gnome-extensions disable organizedtodo@gabrielsmash.github.io
rm -rf ~/.local/share/gnome-shell/extensions/organizedtodo@gabrielsmash.github.io
pkill -x organizedtodo-d
rm -f ~/.local/bin/organizedtodo-daemon ~/.local/share/dbus-1/services/io.github.gabrielsmash.OrganizedTodo.service
dconf reset -f /org/gnome/shell/extensions/organizedtodo/   # apaga também seus dados
```

## Como usar

### Abrir

Clique no ícone na barra superior, ou use **`Alt+Shift+Espaço`**. O atalho já deixa o cursor no campo de texto do rodapé.

### O campo do rodapé

O campo de texto no rodapé cria **o que fizer sentido na tela em que você está**:

| Tela | O campo cria | Texto de dica |
|---|---|---|
| Projetos | um projeto | `Novo projeto...` |
| Listas (dentro de um projeto) | uma lista | `Nova lista...` |
| Tarefas (dentro de uma lista) | uma tarefa | `Nova tarefa...` |

Digite e aperte **Enter**.

### Passo a passo

1. Na tela **Projetos**, digite o nome de um projeto (por exemplo, `Projeto A`) e aperte Enter.
2. Clique no projeto para entrar. Crie as listas, por exemplo `Features` e `Fixes`.
3. Clique em uma lista para entrar e adicione as tarefas.
4. Use a seta de **voltar** no topo para subir um nível.

### Em cada linha

**Projetos e listas** (clique na linha para abrir):

| Botão | O que faz |
|---|---|
| Lápis | Renomeia no próprio lugar. **Enter** salva e **Esc** cancela. Nome vazio é ignorado. |
| Lixeira | Exclui. Se o projeto ou a lista tem conteúdo, o botão vira **"Excluir?"** e pede um segundo clique. |

A pílula azul ao lado do nome mostra quantas tarefas pendentes existem.

**Tarefas:**

| Controle | O que faz |
|---|---|
| Círculo à esquerda | Marca ou desmarca como concluída (o texto fica riscado). |
| Lápis | Edita o texto da tarefa. **Enter** salva e **Esc** cancela. |
| Alvo | **Foco**: fixa a tarefa no topo da lista (uma por lista). Clique de novo para soltar. |
| Lixeira | Exclui a tarefa, sem pedir confirmação. |
| `=` à direita | Arraste para reordenar dentro da lista. |

### Conclusão automática

- Ao marcar a **última tarefa pendente** de um projeto, considerando **todas as listas dele**, o projeto passa para **Concluídos**, aparece uma notificação e você volta para a tela de Projetos.
- Um projeto **sem nenhuma tarefa** nunca é concluído sozinho.
- Para ver os concluídos, use o botão **`Concluídos · N`** no topo da tela de Projetos (ele só aparece se houver algum).
- Dentro dos Concluídos você pode abrir um projeto para consultar, ou clicar em **Reativar** para devolvê-lo à lista ativa.
- **Desmarcar** uma tarefa, ou **adicionar** uma nova, em um projeto concluído o reativa automaticamente.

### Mudar o atalho

```sh
dconf write /org/gnome/shell/extensions/organizedtodo/open-organizedtodo "['<Super>t']"
```

Vale na hora. Para voltar ao padrão: `dconf reset /org/gnome/shell/extensions/organizedtodo/open-organizedtodo`.

## Onde ficam os dados

Tudo é guardado no **dconf**, como um único texto JSON. Quem lê e grava é o daemon; a extensão só conversa com ele.
Não há sincronização entre máquinas.

```sh
# ver
dconf read /org/gnome/shell/extensions/organizedtodo/workspace

# backup
dconf dump /org/gnome/shell/extensions/organizedtodo/ > backup.conf

# restaurar
dconf load /org/gnome/shell/extensions/organizedtodo/ < backup.conf
```

Se você resetar o dconf (por exemplo, `dconf reset -f /`), perde as tarefas. Faça backup de vez em quando.

## Desenvolvimento

```sh
npm test         # testes de interface (com fakes do GNOME e do daemon)
cargo test --manifest-path daemon/Cargo.toml   # regras e persistência do daemon
make schemas     # recompila o schema GSettings depois de editá-lo
make install-daemon   # recompila e reinstala o daemon
make pack        # gera o zip (só a extensão)
```

Como as peças se conectam:

```text
extension.js (interface, roda dentro do gnome-shell)
   └─ client.js ── D-Bus de sessão ──► organizedtodo-daemon (Rust)
                   io.github.gabrielsmash.OrganizedTodo     └─ dconf (GSettings)
```

A extensão nunca bloqueia o shell: toda chamada ao daemon é assíncrona, e a interface se redesenha quando o
daemon emite o sinal `Changed`.

Para testar o daemon sem tocar nos dados reais, rode-o com o backend em memória (pare antes o instalado, porque só
uma instância pode ter o nome no barramento):

```sh
pkill -x organizedtodo-d
GSETTINGS_BACKEND=memory daemon/target/debug/organizedtodo-daemon
gdbus introspect --session --dest io.github.gabrielsmash.OrganizedTodo --object-path /io/github/gabrielsmash/OrganizedTodo
```

Logs da extensão e do daemon: `journalctl --user -g organizedtodo`.

Os testes de interface rodam o `extension.js` real no Node, com pequenos fakes de `St`, `Clutter` e dos módulos do shell (`tests/helpers`). Eles verificam **lógica e navegação, não a aparência**; confira o visual numa sessão real.

Estrutura:

| Arquivo | Papel |
|---|---|
| `daemon/` | Backend em Rust: regras (projetos, listas, tarefas, conclusão), persistência e serviço D-Bus. |
| `client.js` | Cliente D-Bus do daemon; mantém a cópia dos dados para a interface. |
| `extension.js` | As telas e a navegação. |
| `stylesheet.css` | Visual. |
| `icons/` | Ícone do painel. |
| `schemas/` | Configurações (GSettings). |
| `tests/` | Testes. |

## Limitações conhecidas

- A interface está só em português; não há arquivos de tradução.
- Testado apenas no GNOME Shell 50.
- O zip (`make pack`) não inclui o daemon; é preciso compilá-lo a partir do código-fonte.
- Sem sincronização, sem lembretes e sem datas nas tarefas.

## Licença e créditos

MIT. Veja [`LICENCE`](LICENCE).

Baseado no [Todoit](https://github.com/wassimbj/todoit-gnome), copyright (c) 2024 Wassim Ben Jdida, também MIT. O aviso de copyright original foi mantido.
