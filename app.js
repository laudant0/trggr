const polls = [
  {
    title: "Jordan vs LeBron",
    category: "Sports",
    options: [
      { name: "Jordan", votes: 70 },
      { name: "LeBron", votes: 30 }
    ],
    voted: false
  },
  {
    title: "Drake vs Kendrick",
    category: "Music",
    options: [
      { name: "Drake", votes: 48 },
      { name: "Kendrick", votes: 52 }
    ],
    voted: false
  },
  {
    title: "Apple vs Samsung",
    category: "Tech",
    options: [
      { name: "Apple", votes: 60 },
      { name: "Samsung", votes: 40 }
    ],
    voted: false
  }
];

let expanded = false;

function render() {
  const container = document.getElementById("polls");
  container.innerHTML = "";

  polls.forEach((poll, pollIndex) => {

    const card = document.createElement("div");
    card.className = "card";

    const title = document.createElement("h3");
    title.innerText = poll.title;

    const category = document.createElement("div");
    category.innerText = poll.category;
    category.style.color = "#888";
    category.style.fontSize = "12px";

    card.appendChild(category);
    card.appendChild(title);

    poll.options.forEach((opt, optIndex) => {

      const option = document.createElement("div");
      option.className = "option";

      const percent = opt.votes;

      option.innerHTML = `
        <div>${opt.name}</div>
        <div class="bar">
          <div class="fill" style="width:${percent}%"></div>
        </div>
        <small>${percent}%</small>
      `;

      option.onclick = () => vote(pollIndex, optIndex);

      card.appendChild(option);
    });

    container.appendChild(card);
  });
}

function vote(pollIndex, optIndex) {
  const poll = polls[pollIndex];

  if (poll.voted) return;
  poll.voted = true;

  // simulate vote shift
  poll.options.forEach(o => o.votes = o.votes); // keep base

  poll.options[optIndex].votes += 5;

  const total = poll.options.reduce((a, b) => a + b.votes, 0);

  poll.options.forEach(o => {
    o.votes = Math.round((o.votes / total) * 100);
  });

  render();
}

function toggleMore() {
  if (!expanded) {
    polls.push(
      {
        title: "Messi vs Ronaldo",
        category: "Sports",
        options: [
          { name: "Messi", votes: 55 },
          { name: "Ronaldo", votes: 45 }
        ],
        voted: false
      },
      {
        title: "AI replacing humans?",
        category: "Science",
        options: [
          { name: "Yes", votes: 65 },
          { name: "No", votes: 35 }
        ],
        voted: false
      }
    );
  } else {
    polls.length = 3;
  }

  expanded = !expanded;
  render();
}

render();