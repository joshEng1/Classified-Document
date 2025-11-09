const docz = {
    file_input: null,
    previews: document.querySelector(".docz-previews"),
    submitter: document.querySelector(".docz-submitter"),
    _feedback_buttons_added: false,
    _pdf_shown: false,
    main: (() => {
        docz.file_input = document.createElement("input");
        docz.file_input.setAttribute("type", "file");
        // Accept PDFs, DOCX, common images, and optional videos
        docz.file_input.setAttribute("accept", ".pdf,.docx,.png,.jpg,.jpeg,.tif,.tiff,.bmp,.gif,.webp,.mp4,.mov");
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
        console.log('[docz] UI initialized, streaming enabled');
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
        docz._feedback_buttons_added = false; // Reset button flag
        docz._pdf_shown = false; // Reset PDF display flag
        for (let i = docz.chat.children.length; i--;) {
            const child = docz.chat.children[i];
            if (child.classList.contains("docz-preview")) {
                docz.preview_destroy(child);
                continue;
            }
            docz.chat.removeChild(child);
        }
    }),
    _api_base: (() => { try { const q = new URLSearchParams(location.search).get('api'); return q || localStorage.getItem('apiBase') || 'http://localhost:5055'; } catch { return 'http://localhost:5055'; } })(),
    chat_submit: (async () => {
        if (!docz.previews.children.length) return;
        docz.section_show("2");
        const file = docz.previews.children[0].file;
        try {
            await docz._stream_process(file);
        } catch (e) {
            docz.chat_queue_add("Error: " + (e?.message || e));
            docz.chat_queue_run();
        }
    }),
    _stream_process: (async (file) => {
        // Start SSE POST to /api/process-stream
        const fd = new FormData(); fd.append('file', file);
        const resp = await fetch(docz._api_base + '/api/process-stream', { method: 'POST', body: fd });
        const reader = resp.body.getReader(); const dec = new TextDecoder('utf-8');
        let buf = '';
        docz.chat_clear();
        docz.chat_queue_add('Beginning analysis...');
        docz.chat_queue_run();
        while (true) {
            const { value, done } = await reader.read();
            if (done) break;
            buf += dec.decode(value, { stream: true });
            let idx;
            while ((idx = buf.indexOf('\n\n')) !== -1) {
                const pkt = buf.slice(0, idx); buf = buf.slice(idx + 2);
                const ev = docz._parse_sse(pkt);
                if (!ev) continue;
                docz._handle_event(ev, file);
            }
        }
    }),
    _parse_sse: ((chunk) => {
        let name = null, data = '';
        for (const ln of chunk.split(/\n/)) {
            if (ln.startsWith('event: ')) name = ln.slice(7).trim();
            else if (ln.startsWith('data: ')) data += ln.slice(6);
        }
        if (!name) return null;
        try { return { event: name, data: JSON.parse(data || '{}') }; } catch { return { event: name, data: {} }; }
    }),
    _handle_event: ((ev, file) => {
        switch (ev.event) {
            case 'status':
                if (ev.data?.phase) { docz.chat_queue_add('Phase: ' + ev.data.phase.replace(/_/g, ' ')); }
                break;
            case 'extract':
                // Show PDF preview only once at extraction
                if (file && !docz._pdf_shown) {
                    docz._pdf_shown = true;
                    docz.chat_queue_add([file, `page=1`]);
                }
                break;
            case 'precheck':
                docz.chat_queue_add(`Pre-checks: pages=${ev.data.pages}, images=${ev.data.images}`);
                break;
            case 'chunk':
                // Don't show PDF for every chunk - just log chunk processing
                docz.chat_queue_add(`Processing chunk ${ev.data.id || '?'} (page ${ev.data.page || 1})...`);
                break;
            case 'moderation':
                // Show Guardian moderation results with visual feedback
                if (ev.data.unsafe) {
                    docz.chat_queue_add(`⚠️ Safety Alert: ${(ev.data.flags || []).join(', ')}`);
                } else if ((ev.data.flags || []).length) {
                    docz.chat_queue_add(`🔍 Flags detected: ${(ev.data.flags || []).join(', ')}`);
                } else {
                    docz.chat_queue_add(`✓ Content safe (chunk ${ev.data.id || '?'})`);
                }
                // Show risk scores if available
                if (ev.data.scores && Object.keys(ev.data.scores).length > 0) {
                    const topRisks = Object.entries(ev.data.scores)
                        .sort((a, b) => b[1] - a[1])
                        .slice(0, 3)
                        .map(([k, v]) => `${k}:${(v * 100).toFixed(0)}%`)
                        .join(', ');
                    docz.chat_queue_add(`   Risk scores: ${topRisks}`);
                }
                break;
            case 'chunk_pii':
                console.log('=== FRONTEND RECEIVED chunk_pii ===', JSON.stringify(ev.data, null, 2));
                // Show PII detected in this chunk with real-time feedback
                if (ev.data.count > 0) {
                    const pageStr = ev.data.page ? ` (Page ${ev.data.page})` : '';
                    docz.chat_queue_add(`🔒 PII Found${pageStr}: ${ev.data.count} item(s) - ${(ev.data.types || []).join(', ')}`);

                    // Show details of findings
                    if (ev.data.findings && ev.data.findings.length > 0) {
                        console.log('=== Displaying findings ===', ev.data.findings);
                        ev.data.findings.slice(0, 3).forEach(f => {
                            console.log('Finding:', f);
                            const severity = f.severity === 'critical' ? '⚠️ CRITICAL' : (f.severity === 'high' ? '⚠️' : '📝');
                            docz.chat_queue_add(`   ${severity} ${f.type} in "${f.field}"`);
                        });
                        if (ev.data.findings.length > 3) {
                            docz.chat_queue_add(`   ... and ${ev.data.findings.length - 3} more`);
                        }
                    }
                }
                break;
            case 'slm':
                if (ev.data.summary) { docz.chat_queue_add('📄 Summary: ' + ev.data.summary); }
                if (ev.data.key_phrases && ev.data.key_phrases.length) {
                    docz.chat_queue_add('   Key phrases: ' + ev.data.key_phrases.slice(0, 5).join(', '));
                }
                break;
            case 'progress':
                docz.chat_queue_add(`Progress: ${ev.data.completed}/${ev.data.total} chunks analyzed`);
                break;
            case 'final':
                // Display comprehensive test case results
                docz.chat_queue_add('═══════════════════════════════════');
                docz.chat_queue_add('📊 FINAL RESULTS');
                docz.chat_queue_add('═══════════════════════════════════');

                if (ev.data?.final?.label) {
                    docz.chat_queue_add('✅ Classification: ' + ev.data.final.label);
                }
                else if (ev.data?.local?.label) {
                    docz.chat_queue_add('✅ Classification: ' + ev.data.local.label);
                }

                // Test case required fields
                if (ev.data?.meta) {
                    docz.chat_queue_add(`📄 Pages: ${ev.data.meta.pages || 0}`);
                    docz.chat_queue_add(`🖼️ Images: ${ev.data.meta.images || 0}`);
                }

                // Evidence/Citations
                if (ev.data?.evidence && Array.isArray(ev.data.evidence) && ev.data.evidence.length > 0) {
                    docz.chat_queue_add(`📌 Evidence: ${ev.data.evidence.length} citation(s)`);
                    ev.data.evidence.slice(0, 3).forEach((cite, i) => {
                        docz.chat_queue_add(`   ${i + 1}. Page ${cite.page || '?'}: ${(cite.text || '').substring(0, 80)}...`);
                    });
                }

                // Safety assessment
                if (ev.data?.safety) {
                    const safeForKids = ev.data.safety.safe_for_kids !== false;
                    docz.chat_queue_add(`${safeForKids ? '✓' : '⚠️'} Content Safety: ${safeForKids ? 'Safe for kids' : 'NOT safe for kids'}`);
                    if (ev.data.safety.concerns && ev.data.safety.concerns.length > 0) {
                        docz.chat_queue_add(`   Concerns: ${ev.data.safety.concerns.join(', ')}`);
                    }
                }

                // PII detection with detailed citations
                console.log('=== FRONTEND RECEIVED FINAL PII DATA ===');
                console.log('ev.data.pii:', JSON.stringify(ev.data?.pii, null, 2));

                if (ev.data?.pii) {
                    if (ev.data.pii.hasPII || (ev.data.pii.items && ev.data.pii.items.length > 0)) {
                        const piiCount = ev.data.pii.summary?.total || ev.data.pii.items?.length || 0;
                        console.log('=== Displaying PII, count:', piiCount);
                        console.log('=== PII items:', ev.data.pii.items);

                        docz.chat_queue_add('═══════════════════════════════════');
                        docz.chat_queue_add(`⚠️ PII DETECTED: ${piiCount} Instance(s)`);
                        docz.chat_queue_add('═══════════════════════════════════');

                        // Show PII types breakdown with counts
                        if (ev.data.pii.summary?.byType) {
                            const types = Object.entries(ev.data.pii.summary.byType)
                                .map(([type, items]) => `${type}(${items.length})`)
                                .join(', ');
                            docz.chat_queue_add(`📊 Types Found: ${types}`);
                            docz.chat_queue_add('');
                        }

                        // Show detailed findings with field names, pages, and redaction suggestions
                        if (ev.data.pii.items && ev.data.pii.items.length > 0) {
                            docz.chat_queue_add('📋 DETAILED FINDINGS:');
                            docz.chat_queue_add('');

                            // Group by severity
                            const critical = ev.data.pii.items.filter(f => f.severity === 'critical');
                            const high = ev.data.pii.items.filter(f => f.severity === 'high');
                            const medium = ev.data.pii.items.filter(f => f.severity === 'medium');

                            if (critical.length > 0) {
                                console.log('=== Displaying CRITICAL findings ===', critical);
                                docz.chat_queue_add('⚠️ CRITICAL SEVERITY:');
                                critical.forEach((f, i) => {
                                    console.log(`Critical finding ${i}:`, f);
                                    const pageStr = f.page ? ` (Page ${f.page})` : '';
                                    const type = f.type || 'Unknown';
                                    const field = f.field || 'Unknown Field';
                                    const value = f.value || '[not available]';
                                    const redacted = f.redacted || '[REDACTED]';
                                    console.log(`  Displaying: type=${type}, field=${field}, page=${pageStr}, value=${value}, redacted=${redacted}`);
                                    docz.chat_queue_add(`   ${i + 1}. ${type} in "${field}"${pageStr}`);
                                    docz.chat_queue_add(`      Found: "${value}" → Redact as: "${redacted}"`);
                                });
                                docz.chat_queue_add('');
                            }

                            if (high.length > 0) {
                                console.log('=== Displaying HIGH findings ===', high);
                                docz.chat_queue_add('⚠️ HIGH SEVERITY:');
                                high.slice(0, 10).forEach((f, i) => {
                                    console.log(`High finding ${i}:`, f);
                                    const pageStr = f.page ? ` (Page ${f.page})` : '';
                                    const type = f.type || 'Unknown';
                                    const field = f.field || 'Unknown Field';
                                    const value = f.value || '[not available]';
                                    const redacted = f.redacted || '[REDACTED]';
                                    console.log(`  Displaying: type=${type}, field=${field}, page=${pageStr}, value=${value}, redacted=${redacted}`);
                                    docz.chat_queue_add(`   ${i + 1}. ${type} in "${field}"${pageStr}`);
                                    docz.chat_queue_add(`      Found: "${value}" → Redact as: "${redacted}"`);
                                });
                                if (high.length > 10) {
                                    docz.chat_queue_add(`   ... and ${high.length - 10} more high severity items`);
                                }
                                docz.chat_queue_add('');
                            }

                            if (medium.length > 0) {
                                console.log('=== Displaying MEDIUM findings ===', medium);
                                docz.chat_queue_add('📝 MEDIUM SEVERITY:');
                                medium.slice(0, 5).forEach((f, i) => {
                                    console.log(`Medium finding ${i}:`, f);
                                    const pageStr = f.page ? ` (Page ${f.page})` : '';
                                    const type = f.type || 'Unknown';
                                    const field = f.field || 'Unknown Field';
                                    const value = f.value || '[not available]';
                                    const redacted = f.redacted || '[REDACTED]';
                                    console.log(`  Displaying: type=${type}, field=${field}, page=${pageStr}, value=${value}, redacted=${redacted}`);
                                    docz.chat_queue_add(`   ${i + 1}. ${type} in "${field}"${pageStr}`);
                                    docz.chat_queue_add(`      Found: "${value}" → Redact as: "${redacted}"`);
                                });
                                if (medium.length > 5) {
                                    docz.chat_queue_add(`   ... and ${medium.length - 5} more medium severity items`);
                                }
                            }
                        } else if (ev.data.pii.evidence) {
                            // Fallback to evidence string format
                            docz.chat_queue_add('📋 Evidence & Redaction Suggestions:');
                            const evidenceLines = ev.data.pii.evidence.split('\n').slice(0, 15);
                            evidenceLines.forEach(line => {
                                if (line.trim()) docz.chat_queue_add(line);
                            });
                        }

                        // Show severity summary
                        if (ev.data.pii.summary) {
                            docz.chat_queue_add('');
                            docz.chat_queue_add('📊 Severity Breakdown:');
                            if (ev.data.pii.summary.critical > 0) {
                                docz.chat_queue_add(`   ⚠️ Critical: ${ev.data.pii.summary.critical} (SSN, etc.)`);
                            }
                            if (ev.data.pii.summary.high > 0) {
                                docz.chat_queue_add(`   ⚠️ High: ${ev.data.pii.summary.high} (Phone, Email, Address, DOB)`);
                            }
                            if (ev.data.pii.summary.medium > 0) {
                                docz.chat_queue_add(`   📝 Medium: ${ev.data.pii.summary.medium} (ZIP codes, etc.)`);
                            }
                        }
                    } else {
                        docz.chat_queue_add('✓ No PII Detected');
                    }
                } else if (ev.data?.pii && ev.data.pii.found) {
                    docz.chat_queue_add(`⚠️ PII Detected: ${ev.data.pii.types ? ev.data.pii.types.join(', ') : 'Yes'}`);
                } else {
                    docz.chat_queue_add('✓ No PII Detected');
                }

                docz.chat_queue_add('═══════════════════════════════════');
                break;
            case 'error':
                docz.chat_queue_add('❌ Error: ' + (ev.data?.detail || ev.data?.error || 'unknown'));
                break;
        }
        docz.chat_queue_run();
    }),
    chat_queue_add: ((value) => {
        docz._chat_queue.push(value);
    }),
    chat_queue_run: (() => {
        if (!docz._chat_queue.length) {
            // Only add feedback buttons once
            if (!docz._feedback_buttons_added) {
                docz._feedback_buttons_added = true;
                const buttons = document.createElement("div");
                buttons.className = "docz-flex";
                const button_yes = document.createElement("button");
                button_yes.innerText = "CORRECT";
                buttons.appendChild(button_yes);
                const button_no = document.createElement("button");
                button_no.innerText = "WRONG";
                buttons.appendChild(button_no);
                docz.chat.appendChild(buttons);
            }
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
