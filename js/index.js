const docz = {
    file_input: null,
    previews: document.querySelector(".docz-previews"),
    submitter: document.querySelector(".docz-submitter"),
    main: (() => {
        docz.file_input = document.createElement("input");
        docz.file_input.setAttribute("type", "file");
        docz.file_input.setAttribute("accept", ".pdf,.mp4,.mov");
        docz.file_input.setAttribute("multiple", "");
        docz.file_input.addEventListener("change", (() => {
            for (let i = 0; i < docz.file_input.files.length; i++) {
                setTimeout(() => {
                    docz.previews.appendChild(docz.preview_create(docz.file_input.files[i], undefined, true));
                    docz.previews_update();
                }, (i * 511));
            }
        }));
        docz.submitter.setAttribute("disabled", "");
        docz.section_show("1");
    }),
    section_show: ((id) => {
        docz.chat_clear();
        for (let section of document.querySelectorAll("*[data-section-id]")) {
            section.style.display = "none";
        }
        document.querySelector('*[data-section-id="' + id + '"]').style.display = "";
    }),
    previews_update: (() => {
        setTimeout(() => {
            docz.previews.style.maxHeight = ("min(" + docz.previews.scrollHeight + "px, 60vh)");
        }, 255);
    }),
    preview_create: ((file, hash, destroyable) => {
        const preview = document.createElement("div");
        preview.className = "docz-preview";
        preview.file = file;
        preview.embed = document.createElement("embed");
        preview.embed.setAttribute("src", (URL.createObjectURL(file) + (hash ? ("#" + hash) : "")));
        preview.appendChild(preview.embed);
        if (destroyable) {
            preview.destroyer = document.createElement("button");
            preview.destroyer.className = "docz-button-round";
            preview.destroyer.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" width="20" height="20"><path d="m4.34 2.93 12.73 12.73-1.41 1.41L2.93 4.35z"/><path d="M17.07 4.34 4.34 17.07l-1.41-1.41L15.66 2.93z"/></svg>';
            preview.destroyer.onclick = (() => {
                preview.style.animation = "docz-fade-out 0.25s forwards";
                setTimeout(() => {
                    docz.preview_destroy(preview);
                    docz.previews_update();
                }, 255);
            });
            preview.appendChild(preview.destroyer);
        }
        docz.submitter.removeAttribute("disabled");
        return preview;
    }),
    preview_destroy: ((preview) => {
        preview.parentNode.removeChild(preview);
        URL.revokeObjectURL(preview.embed.getAttribute("url"));
        preview.file = "";
        if (!docz.previews.children.length) {
            docz.submitter.setAttribute("disabled", "");
        }
    }),

    typewrite: ((element, value, timeout, i = 0) => {
        element.innerHTML += value[i++];
        if (i !== value.length) {
            setTimeout(() => {
                docz.typewrite(element, value, timeout, i);
            }, timeout);
        }
    }),

    chat: document.querySelector(".docz-chat"),
    _chat_queue: [],
    chat_clear: (() => {
        docz._chat_queue.length = 0;
        for (let i = docz.chat.children.length; i--;) {
            const child = docz.chat.children[i];
            if (child.classList.contains("docz-preview")) {
                docz.preview_destroy(child);
                continue;
            }
            docz.chat.removeChild(child);
        }
    }),
    chat_submit: (() => {
        docz.section_show("2");
        docz.chat_queue_add("Hello there!");
        docz.chat_queue_add("I have analyzed your file.");
        docz.chat_queue_add([docz.previews.children[0].file, "page=2"]);
        docz.chat_queue_add("It is a public file.");
        docz.chat_queue_run();
    }),
    chat_queue_add: ((value) => {
        docz._chat_queue.push(value);  
    }),
    chat_queue_run: (() => {
        if (!docz._chat_queue.length) {
            const buttons = document.createElement("div");
            buttons.className = "docz-flex";
            const button_yes = document.createElement("button");
            button_yes.innerText = "CORRECT";
            buttons.appendChild(button_yes);
            const button_no = document.createElement("button");
            button_no.innerText = "WRONG";
            buttons.appendChild(button_no);
            docz.chat.appendChild(buttons);
            return;
        }
        const timeout = 33;
        const value = docz._chat_queue[0];
        docz._chat_queue.splice(0, 1);
        switch (typeof value) {
            case "string":
                const message = document.createElement("p");
                docz.chat.appendChild(message);
                docz.typewrite(message, value, timeout);
                break;
            case "object":
                const preview = docz.chat.appendChild(docz.preview_create(value[0], value[1], false));
                setTimeout(() => {
                    preview.setAttribute("data-category", "3");
                }, 750);
                break;
        }
        setTimeout(() => {
            docz.chat_queue_run();
        }, (timeout * ((value.length || 10) + 5)));
    })
};
docz.main();